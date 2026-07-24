/**
 * fridaClient.ts —— 对 `frida` npm 包的薄封装
 *
 * 目的：项目里所有的 Frida 交互（越狱检测、应用枚举、图标获取、脚本注入、脱壳）
 *      都通过这一层进行，不再依赖用户机器上的 `frida-tools` / Python。
 *
 * 关键设计：
 *   - device 缓存：同一 deviceId 只解析一次 device，避免频繁 enumerate_devices 造成的开销
 *   - 类型放宽：`frida` 的 d.ts 在部分版本不完整，用 `any` 保底
 *   - 出错都往上抛：由上层决定友好化提示 / 日志
 */

// frida@16.x 是 CommonJS 模块（与设备端 frida-server 16.2.x major 版本一致，通信协议兼容）。
// 直接 require 即可，不需要 dynamic import 的 hack。
// —— 之前用过 frida@17.x（ESM）需要 new Function('m','return import(m)') 兜底，
//    降级到 16.x 后不再需要。
let _frida: any = null;
function getFridaSync(): any {
  if (!_frida) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _frida = require('frida');
    if (!_frida || typeof _frida.getUsbDevice !== 'function') {
      throw new Error('frida module 加载异常：找不到 getUsbDevice 导出');
    }
  }
  return _frida;
}
// 保留 async 签名，避免下游调用点大改
async function getFrida(): Promise<any> {
  return getFridaSync();
}

const deviceCache = new Map<string, any>();

/**
 * 获取指定 deviceId 的设备句柄。
 * - 若 deviceId 为空，则返回第一个 USB 设备（相当于 frida.getUsbDevice()）
 * - 会缓存结果，同一 deviceId 复用同一 device 对象
 */
export async function getDevice(deviceId?: string): Promise<any> {
  const frida = await getFrida();
  if (!deviceId) {
    return await frida.getUsbDevice();
  }
  const cached = deviceCache.get(deviceId);
  if (cached) return cached;
  // getDevice(id, {timeout: 1000}) 若设备暂时不可见会抛 error；不 catch，交给上层
  const device = await frida.getDevice(deviceId, { timeout: 5000 });
  deviceCache.set(deviceId, device);
  return device;
}

/**
 * 探测设备端 frida-server 是否可达。
 * 用 `enumerateApplications({scope:'minimal'})` 作为最轻探测（不带图标 / 不解析 Info.plist）。
 *
 * 只要不抛就说明 frida-server 可达 → 一定是越狱设备。
 */
export async function probeFridaAvailable(deviceId: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const device = await getDevice(deviceId);
    // 优先用 querySystemParameters —— 单次 RPC，最轻
    if (typeof device.querySystemParameters === 'function') {
      const params = await device.querySystemParameters();
      return { ok: true, reason: `system: ${params?.os?.id || 'unknown'} ${params?.os?.version || ''}` };
    }
    // 兜底：enumerate minimal（不会真的加载全部应用）
    const apps = await device.enumerateApplications({ scope: 'minimal' });
    return { ok: true, reason: `${apps.length} apps enumerated` };
  } catch (err: any) {
    return { ok: false, reason: (err?.message || String(err)).slice(0, 200) };
  }
}

export interface FridaAppMeta {
  id: string;           // bundleId
  name: string;         // 显示名
  pid: number;          // 0 表示未运行
  version?: string;
  icon?: string;        // base64 (PNG，一般 60x60 或 120x120)
  isSystem?: boolean;   // iOS 上只有 User 类型才被认为是"用户应用"
}

/**
 * 列出设备上所有应用。scope='full' 时包含图标 + parameters（体积较大，耗时也长）
 */
export async function enumerateApplications(
  deviceId: string,
  opts: { includeIcons?: boolean; onlyUser?: boolean } = {}
): Promise<FridaAppMeta[]> {
  const device = await getDevice(deviceId);
  const scope = opts.includeIcons ? 'full' : 'minimal';
  const apps: any[] = await device.enumerateApplications({ scope });

  const result: FridaAppMeta[] = [];
  for (const app of apps) {
    const params = app.parameters || {};
    // iOS: params.type 是 'User' / 'System'（对应 LSApplicationProxy.applicationType）
    const isSystem = params.type ? params.type !== 'User' : false;
    if (opts.onlyUser && isSystem) continue;

    // 图标：params.icons 是数组，每个 { format, image (Buffer), width, height }
    let iconBase64 = '';
    if (opts.includeIcons && Array.isArray(params.icons) && params.icons.length > 0) {
      // 取尺寸最大的那张（通常最后一张）；image 是 Buffer / Uint8Array
      const iconEntry = params.icons[params.icons.length - 1];
      const raw = iconEntry?.image;
      if (raw) {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        iconBase64 = buf.toString('base64');
      }
    }

    result.push({
      id: app.identifier,
      name: app.name || app.identifier,
      pid: app.pid || 0,
      version: params.version || params.shortVersion || '',
      icon: iconBase64 || undefined,
      isSystem,
    });
  }
  return result;
}

/**
 * 获取单个应用的图标（用户点击应用时按需拉取，减小首屏开销）
 */
export async function getApplicationIcon(deviceId: string, bundleId: string): Promise<string | undefined> {
  const apps = await enumerateApplications(deviceId, { includeIcons: true, onlyUser: false });
  const hit = apps.find((a) => a.id === bundleId);
  return hit?.icon;
}

// ================== Attach / Spawn / Script ==================

/**
 * 拉起并附加一个 iOS 应用（若已运行则直接 attach）。
 * 返回 { session, pid, appName }，用完后调用者必须 session.detach()。
 */
export async function attachOrSpawn(
  deviceId: string,
  bundleId: string,
  onLog?: (msg: string) => void
): Promise<{ session: any; pid: number; appName: string; wasSpawned: boolean }> {
  const device = await getDevice(deviceId);
  const log = onLog || (() => {});

  // 先查是否已运行
  const apps: any[] = await device.enumerateApplications({ scope: 'minimal' });
  const target = apps.find((a) => a.identifier === bundleId || a.name === bundleId);
  if (!target) {
    throw new Error(`未找到目标应用 (bundleId=${bundleId})`);
  }
  const appName = target.name || bundleId;

  if (target.pid && target.pid !== 0) {
    log(`[Frida] 应用已运行 (pid=${target.pid})，直接附加`);
    const session = await device.attach(target.pid);
    return { session, pid: target.pid, appName, wasSpawned: false };
  }

  log(`[Frida] 应用未运行，spawn ${bundleId}...`);
  const pid: number = await device.spawn([bundleId]);
  log(`[Frida] Spawned pid=${pid}, attaching...`);
  const session = await device.attach(pid);
  await device.resume(pid);
  return { session, pid, appName, wasSpawned: true };
}

/**
 * 在已有 session 上加载一个脚本，并把 message 回调转发给 onMessage
 * 返回 script 句柄，用完后 script.unload()
 */
export async function loadScript(
  session: any,
  scriptSource: string,
  onMessage: (msg: any, data?: Buffer | null) => void
): Promise<any> {
  const script = await session.createScript(scriptSource);
  script.message.connect((message: any, data: any) => {
    try {
      onMessage(message, data || null);
    } catch (e) {
      // 消息回调里出错不能影响脚本运行，只打日志
      console.error('[fridaClient] onMessage callback error:', e);
    }
  });
  await script.load();
  return script;
}

/** 清除 device 缓存（例如设备断开重连后）*/
export function clearDeviceCache(deviceId?: string): void {
  if (deviceId) {
    deviceCache.delete(deviceId);
  } else {
    deviceCache.clear();
  }
}
