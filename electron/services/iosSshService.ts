import { exec, spawn, ChildProcess } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import fs from 'node:fs/promises';
import { getIproxyPath, getSshpassPath } from '../utils/paths';
import { probeFridaAvailable } from './fridaClient';

const execPromise = util.promisify(exec);

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime?: string;
  permissions?: string;
}

// 存储每个设备的 iproxy 进程 —— 现在需要同时记录端口，方便复用/清理
interface IproxyRecord {
  process: ChildProcess;
  localPort: number;
}
const iproxyProcesses = new Map<string, IproxyRecord>();

// ================== iproxy 端口管理 ==================

/**
 * 检查本地端口是否可用（未被占用）
 */
function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * 从 preferredPort 起找一个可用端口，最多试 20 次
 */
async function pickAvailablePort(preferredPort: number): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const p = preferredPort + i;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(p)) return p;
  }
  // 全部失败也返回起始端口，让上层报错
  return preferredPort;
}

/**
 * 等待端口真正建立监听（iproxy 启动后需要几百毫秒才 listen）
 */
async function waitForPortListening(port: number, host = '127.0.0.1', timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const available = await isPortAvailable(port, host);
    if (!available) {
      // 端口已被占用 = 有人在 listen（iproxy 已 ready）
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * 启动 iproxy 端口转发（deviceRemotePort -> localPort）
 * 如果同设备已有 iproxy 在跑，直接复用；否则自动挑一个可用本地端口
 *
 * @returns 实际使用的本地端口
 */
async function startIproxy(deviceId: string, preferredLocalPort = 2222, remotePort = 22): Promise<number> {
  const existing = iproxyProcesses.get(deviceId);
  if (existing && !existing.process.killed) {
    // 已有 iproxy —— 用它即可，避免反复 kill/restart 引发的时序问题
    return existing.localPort;
  }

  const iproxyPath = getIproxyPath();
  if (!iproxyPath) {
    throw new Error('iproxy 工具未找到，请确保 libimobiledevice 已经打包在 resources/bin 下');
  }

  const localPort = await pickAvailablePort(preferredLocalPort);
  console.log(`[iproxy] Starting for device ${deviceId}: ${localPort} -> device:${remotePort} (binary: ${iproxyPath})`);

  const iproxy = spawn(iproxyPath, [`${localPort}:${remotePort}`, '-u', deviceId]);

  iproxy.stdout?.on('data', (d) => console.log(`[iproxy] stdout: ${d.toString().trim()}`));
  iproxy.stderr?.on('data', (d) => console.log(`[iproxy] stderr: ${d.toString().trim()}`));
  iproxy.on('exit', (code) => {
    console.log(`[iproxy] Process for ${deviceId} exited with code ${code}`);
    const cur = iproxyProcesses.get(deviceId);
    if (cur?.process === iproxy) {
      iproxyProcesses.delete(deviceId);
    }
  });
  iproxy.on('error', (err) => {
    console.error(`[iproxy] Failed to spawn: ${err.message}`);
  });

  iproxyProcesses.set(deviceId, { process: iproxy, localPort });

  // 等待端口真正建立监听（最多 5 秒）
  const ok = await waitForPortListening(localPort, '127.0.0.1', 5000);
  if (!ok) {
    console.warn(`[iproxy] Timed out waiting for port ${localPort} to be listening (device may not be ready)`);
  } else {
    console.log(`[iproxy] Port ${localPort} is listening, forwarding ready`);
  }

  // 额外给设备端的 sshd 一点点响应时间
  await new Promise((r) => setTimeout(r, 300));

  return localPort;
}

// 停止 iproxy
export function stopIproxy(deviceId: string): void {
  const record = iproxyProcesses.get(deviceId);
  if (record) {
    try {
      record.process.kill();
    } catch {
      /* ignore */
    }
    iproxyProcesses.delete(deviceId);
  }
}

// 停止所有 iproxy 进程（应用退出时调用，避免遗留僵尸进程 / 端口占用）
export function stopAllIproxy(): void {
  for (const [deviceId, record] of iproxyProcesses) {
    try {
      record.process.kill();
    } catch (e) {
      // 忽略清理时的错误
    }
    iproxyProcesses.delete(deviceId);
  }
}

/**
 * 拿到当前设备的 iproxy 本地端口，如果没启动就启动
 */
async function ensureIproxy(deviceId: string): Promise<number> {
  const record = iproxyProcesses.get(deviceId);
  if (record && !record.process.killed) return record.localPort;
  return startIproxy(deviceId, 2222, 22);
}

// ================== 越狱检测 ==================

// 常见越狱工具的 bundleId —— installation_proxy 里出现任一即判定越狱
const JAILBREAK_BUNDLE_HINTS = [
  // 包管理器
  'org.coolstar.SileoStore', 'org.coolstar.sileostorenightly', 'org.coolstar.Sileo',
  'xyz.willy.Zebra', 'zbra.willy.xyz',
  'com.saurik.Cydia',
  // 越狱工具本体
  'com.opa334.TrollStore', 'com.opa334.TrollStorePersistenceHelper', 'com.opa334.trollstorehelper',
  'com.wwg135.Dopamine', 'com.opa334.Dopamine', 'com.opa334.dopamine',
  'com.palera1n.palera1nLoader',
  'com.limneos.paleraincertloader',
  // 文件管理 / 常用越狱工具
  'com.tigisoftware.Filza', 'com.tigisoftware.FilzaEscaped',
  'ch.mneuhaus.MTerminal',
  'com.aricloverally.NewTerm',
  // Frida
  're.frida.server',
];

/**
 * 通过 installation_proxy 查已装应用，命中越狱工具就判定越狱
 * 这是最可靠的一条路径：不依赖 SSH 或 frida-server，只要 usbmuxd 通就能查
 */
async function checkJailbreakViaInstalledApps(deviceId: string): Promise<{ ok: boolean; matched: string[] }> {
  const matched: string[] = [];
  try {
    const { services } = require('appium-ios-device');
    const installationProxy = await services.startInstallationProxyService(deviceId);
    try {
      // 查所有应用（System + User）；越狱工具可能被登记为 System 类型
      const apps = await installationProxy.listApplications({});
      const ids = new Set<string>(Object.keys(apps || {}));
      for (const hint of JAILBREAK_BUNDLE_HINTS) {
        if (ids.has(hint)) matched.push(hint);
      }
      // 兜底：模糊匹配包含关键字的 bundleId（防止版本变化 / 大小写差异）
      const lowerHints = ['sileo', 'cydia', 'zebra', 'trollstore', 'dopamine', 'palera1n', 'filza', 'frida'];
      for (const id of ids) {
        const l = id.toLowerCase();
        if (lowerHints.some((h) => l.includes(h))) {
          if (!matched.includes(id)) matched.push(id);
        }
      }
    } finally {
      try {
        if (typeof installationProxy.close === 'function') installationProxy.close();
      } catch {
        /* ignore */
      }
    }
    return { ok: matched.length > 0, matched };
  } catch (err: any) {
    console.log(`[Jailbreak Check] installation_proxy probe failed: ${err?.message || err}`);
    return { ok: false, matched };
  }
}

/**
 * 通过内嵌的 `frida` npm 包直接与设备端 frida-server 通信 —— 不依赖用户机器上的 frida-tools。
 * 只要能连上 frida-server 就一定是越狱设备。
 */
async function checkJailbreakViaFrida(deviceId: string): Promise<{ ok: boolean; reason: string }> {
  return await probeFridaAvailable(deviceId);
}

/**
 * 通过 SSH 探测：尝试 22/44 两种常见端口（checkra1n=22，palera1n rootless 也支持 22，
 * 但某些 rootless 变体会用 44）× 常见默认密码
 */
const SSH_CANDIDATES: Array<{ remotePort: number; password: string; label: string }> = [
  { remotePort: 22, password: 'alpine', label: 'root@22 alpine' },
  { remotePort: 44, password: 'alpine', label: 'root@44 alpine' },
  { remotePort: 22, password: 'root', label: 'root@22 root' },
  { remotePort: 22, password: 'dottie', label: 'root@22 dottie' },
];

async function trySshAuth(sshpassPath: string, localPort: number, password: string): Promise<boolean> {
  try {
    const { stdout } = await execPromise(
      `"${sshpassPath}" -p ${JSON.stringify(password)} ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o PreferredAuthentications=password -o PubkeyAuthentication=no -p ${localPort} root@127.0.0.1 "echo jailbroken"`,
      { timeout: 10000 }
    );
    return stdout.trim() === 'jailbroken';
  } catch (err: any) {
    console.log(`[Jailbreak Check] SSH auth fail on port ${localPort}: ${(err?.message || '').slice(0, 120)}`);
    return false;
  }
}

async function checkJailbreakViaSsh(deviceId: string): Promise<{ ok: boolean; hit?: { remotePort: number; localPort: number; password: string }; reason: string }> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) {
    return { ok: false, reason: 'sshpass 未找到（libimobiledevice bundle 缺失）' };
  }

  // 按端口分组：同一个 remotePort 复用 iproxy
  const byPort = new Map<number, Array<{ password: string; label: string }>>();
  for (const c of SSH_CANDIDATES) {
    const arr = byPort.get(c.remotePort) || [];
    arr.push({ password: c.password, label: c.label });
    byPort.set(c.remotePort, arr);
  }

  const tried: string[] = [];
  for (const [remotePort, candidates] of byPort) {
    let localPort: number;
    try {
      // 每个 remotePort 分配不同的 preferred local port，避免冲突
      const prefer = remotePort === 22 ? 2222 : 2200 + remotePort;
      localPort = await startIproxy(deviceId, prefer, remotePort);
    } catch (err: any) {
      tried.push(`iproxy(${remotePort}) 失败: ${err.message}`);
      continue;
    }
    for (const cand of candidates) {
      tried.push(cand.label);
      const ok = await trySshAuth(sshpassPath, localPort, cand.password);
      if (ok) {
        return { ok: true, hit: { remotePort, localPort, password: cand.password }, reason: `SSH ${cand.label} OK` };
      }
    }
    // 该端口所有密码都失败：iproxy 保持开启，其他调用还能复用
  }

  return { ok: false, reason: `SSH 探测全部失败 (tried: ${tried.join(', ')})` };
}

/**
 * 三路合一的越狱检测。任一成功即判定为越狱。
 * 每一步都会打详细日志，方便排查究竟在哪一步失败。
 */
// 记住 SSH 成功的连接参数，供后续 execSshCommand / listSshDirectory 等直接复用
interface SshConnInfo {
  localPort: number;
  password: string;
}
const sshConnByDevice = new Map<string, SshConnInfo>();

export function getSshConn(deviceId: string): SshConnInfo | undefined {
  return sshConnByDevice.get(deviceId);
}

export async function checkJailbreak(deviceId: string): Promise<boolean> {
  console.log(`\n[Jailbreak Check] ===== Start check for device: ${deviceId} =====`);

  // ── 方式 1：Installation Proxy（最可靠，不依赖 SSH/Frida）─────────────
  const apps = await checkJailbreakViaInstalledApps(deviceId);
  if (apps.ok) {
    console.log(`[Jailbreak Check] ✓ installation_proxy hit: ${apps.matched.join(', ')}`);
    return true;
  }
  console.log(`[Jailbreak Check] · installation_proxy: 未命中越狱工具（matched=[${apps.matched.join(',')}]）`);

  // ── 方式 2：Frida（脱壳实际依赖的服务，若装了 frida-server 最直接）─────
  const frida = await checkJailbreakViaFrida(deviceId);
  if (frida.ok) {
    console.log(`[Jailbreak Check] ✓ Frida detected: ${frida.reason}`);
    return true;
  }
  console.log(`[Jailbreak Check] · Frida: ${frida.reason}`);

  // ── 方式 3：SSH（老式越狱兼容，多端口多密码）─────────────────────────
  const ssh = await checkJailbreakViaSsh(deviceId);
  if (ssh.ok && ssh.hit) {
    console.log(`[Jailbreak Check] ✓ SSH detected: ${ssh.reason}`);
    sshConnByDevice.set(deviceId, { localPort: ssh.hit.localPort, password: ssh.hit.password });
    return true;
  }
  console.log(`[Jailbreak Check] · SSH: ${ssh.reason}`);

  console.log(`[Jailbreak Check] ===== Verdict: NOT jailbroken =====\n`);
  return false;
}

/**
 * 允许上层（例如"手动强制越狱模式"）显式登记 SSH 参数
 * password 缺省时默认 alpine
 */
export async function setForcedJailbreak(deviceId: string, opts?: { password?: string; remotePort?: number }): Promise<void> {
  const password = opts?.password || 'alpine';
  const remotePort = opts?.remotePort || 22;
  const localPort = await startIproxy(deviceId, remotePort === 22 ? 2222 : 2200 + remotePort, remotePort);
  sshConnByDevice.set(deviceId, { localPort, password });
}

// ================== SSH 高层 API ==================
// 说明：以下 API 会自动使用 getSshConn(deviceId) 的连接参数；
//       如果之前没 checkJailbreak 过，就按老默认（2222 -> 22，alpine）走一遍。

async function getConnOrDefault(deviceId: string): Promise<SshConnInfo> {
  let conn = sshConnByDevice.get(deviceId);
  if (!conn) {
    // 老默认：本地 2222 -> 22，密码 alpine
    const localPort = await ensureIproxy(deviceId);
    conn = { localPort, password: 'alpine' };
    sshConnByDevice.set(deviceId, conn);
  } else {
    // 复用前先确认 iproxy 还活着
    const rec = iproxyProcesses.get(deviceId);
    if (!rec || rec.process.killed) {
      const localPort = await ensureIproxy(deviceId);
      conn = { ...conn, localPort };
      sshConnByDevice.set(deviceId, conn);
    }
  }
  return conn;
}

function sshBaseCmd(sshpass: string, conn: SshConnInfo): string {
  return `"${sshpass}" -p ${JSON.stringify(conn.password)} ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PreferredAuthentications=password -o PubkeyAuthentication=no -p ${conn.localPort} root@127.0.0.1`;
}

function scpBaseCmd(sshpass: string, conn: SshConnInfo): string {
  return `"${sshpass}" -p ${JSON.stringify(conn.password)} scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PreferredAuthentications=password -o PubkeyAuthentication=no -P ${conn.localPort}`;
}

// 执行任意 SSH 命令
export async function execSshCommand(deviceId: string, command: string): Promise<string> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) throw new Error('sshpass 工具未找到');
  const conn = await getConnOrDefault(deviceId);
  try {
    const { stdout } = await execPromise(
      `${sshBaseCmd(sshpassPath, conn)} "${command.replace(/"/g, '\\"')}"`,
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    return stdout;
  } catch (err: any) {
    throw new Error(`SSH 命令执行失败: ${err.message}`);
  }
}

// 通过 SSH 列出目录
export async function listSshDirectory(deviceId: string, dirPath: string): Promise<FileEntry[]> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) throw new Error('sshpass 工具未找到');
  const conn = await getConnOrDefault(deviceId);

  try {
    // 使用 ls -la 获取详细信息
    const { stdout } = await execPromise(
      `${sshBaseCmd(sshpassPath, conn)} "ls -la '${dirPath.replace(/'/g, "'\\''")}'"`,
      { timeout: 10000 }
    );
    
    const lines = stdout.split('\n');
    const entries: FileEntry[] = [];
    const symlinksToResolve: { entry: any; targetPath: string; index: number }[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('total')) continue;
      
      const parts = trimmed.split(/\s+/);
      if (parts.length < 9) continue;
      
      const permissions = parts[0];
      const isSymlink = permissions.startsWith('l');
      let isDir = permissions.startsWith('d');
      const size = parseInt(parts[4], 10);
      let name = parts.slice(8).join(' ');
      
      // 跳过 . 当前目录
      if (name === '.') continue;
      
      // 解析符号链接
      let linkTarget: string | undefined = undefined;
      
      if (name.includes('->')) {
        const segs = name.split('->');
        name = segs[0].trim();
        linkTarget = segs[1]?.trim();
      }
      
      const entry = {
        name,
        isDir,
        size: isNaN(size) ? 0 : size,
        permissions,
        linkTarget,
        resolvedPath: undefined as string | undefined,
        linkTargetIsDir: undefined as boolean | undefined,
      };
      
      const index = entries.length;
      entries.push(entry);
      
      // 收集需要解析的符号链接
      if (linkTarget) {
        // 解析目标路径（相对路径转绝对路径）
        let targetPath = linkTarget;
        if (!targetPath.startsWith('/')) {
          // 相对路径，需要基于当前目录解析
          const pathParts = dirPath.split('/').filter(Boolean);
          const targetParts = targetPath.split('/');
          
          for (const part of targetParts) {
            if (part === '..') {
              pathParts.pop();
            } else if (part !== '.') {
              pathParts.push(part);
            }
          }
          targetPath = '/' + pathParts.join('/');
        }
        
        symlinksToResolve.push({ entry, targetPath, index });
      }
    }
    
    // 批量解析符号链接
    if (symlinksToResolve.length > 0) {
      // 构建批量检查脚本
      const commands = symlinksToResolve.map(({ targetPath }, idx) => {
        const escapedPath = targetPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
        return `resolved=$(readlink -f "${escapedPath}" 2>/dev/null || echo "${escapedPath}"); if [ -d "$resolved" ]; then echo "${idx}|$resolved|dir"; else echo "${idx}|$resolved|file"; fi`;
      }).join('; ');
      
      try {
        const { stdout: batchResult } = await execPromise(
          `${sshBaseCmd(sshpassPath, conn)} '${commands}'`,
          { timeout: 10000 }
        );
        
        const results = batchResult.trim().split('\n');
        
        for (const line of results) {
          const parts = line.split('|');
          if (parts.length === 3) {
            const idx = parseInt(parts[0], 10);
            const resolvedPath = parts[1];
            const isDir = parts[2] === 'dir';
            
            if (!isNaN(idx) && idx < symlinksToResolve.length) {
              const { entry } = symlinksToResolve[idx];
              if (resolvedPath && resolvedPath.startsWith('/')) {
                entry.resolvedPath = resolvedPath;
                entry.linkTargetIsDir = isDir;
                if (isDir) {
                  entry.isDir = true;
                }
              }
            }
          }
        }
      } catch (err) {
        console.log('[SSH] Failed to batch resolve symlinks:', err);
        // 批量解析失败，符号链接信息保持原样
      }
    }
    
    return entries;
  } catch (err: any) {
    throw new Error(`SSH 列出目录失败: ${err.message}`);
  }
}

// 通过 SSH 下载文件
export async function downloadSshFile(deviceId: string, remotePath: string, localPath: string): Promise<void> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) throw new Error('sshpass 工具未找到');
  const conn = await getConnOrDefault(deviceId);
  try {
    await execPromise(
      `${scpBaseCmd(sshpassPath, conn)} root@127.0.0.1:'${remotePath.replace(/'/g, "'\\''")}' '${localPath}'`,
      { timeout: 60000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 下载文件失败: ${err.message}`);
  }
}

/**
 * 递归下载一个目录（用于 iOS 脱壳时拉取整个 .app bundle）
 *
 * 实现：scp -r remoteDir localParent —— scp -r 会自动在 localParent 下创建同名子目录
 *
 * @param deviceId  设备 UDID
 * @param remoteDir 设备上的绝对路径（例如 /var/containers/Bundle/Application/xxx/MyApp.app）
 * @param localDir  本地目标路径（例如 /tmp/mktools_dump/Payload/MyApp.app）
 *                  会先确保 localDir 的父目录存在，scp 会把 remoteDir 复制成 localDir 本身
 */
export async function downloadSshDirectory(deviceId: string, remoteDir: string, localDir: string): Promise<void> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) throw new Error('sshpass 工具未找到');
  const conn = await getConnOrDefault(deviceId);

  // scp -r 的行为：src 是目录时会把 src 目录本身复制到 dst 的父目录下并保留 src 的 basename
  // 为了让最终结果是 localDir，我们让 dst = localDir 的父目录，然后必要时 rename
  const localParent = require('node:path').dirname(localDir);
  const remoteBase = require('node:path').basename(remoteDir);
  const localAutoName = require('node:path').join(localParent, remoteBase);

  // 确保父目录存在
  await fs.mkdir(localParent, { recursive: true });

  try {
    await execPromise(
      `${scpBaseCmd(sshpassPath, conn)} -r root@127.0.0.1:'${remoteDir.replace(/'/g, "'\\''")}' '${localParent}'`,
      { timeout: 15 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 } // 15 min，大型 app bundle 可能需要很久
    );
  } catch (err: any) {
    throw new Error(`SSH 递归下载失败: ${err.message}`);
  }

  // 如果 scp 落地路径和期望路径不一致，rename 一下
  if (localAutoName !== localDir) {
    try {
      await fs.rename(localAutoName, localDir);
    } catch {
      // rename 失败通常是因为 localDir 已存在或 localAutoName 不存在 —— 忽略
    }
  }
}

// 通过 SSH 上传文件
export async function uploadSshFile(deviceId: string, localPath: string, remotePath: string): Promise<void> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) throw new Error('sshpass 工具未找到');
  const conn = await getConnOrDefault(deviceId);
  try {
    await execPromise(
      `${scpBaseCmd(sshpassPath, conn)} '${localPath}' root@127.0.0.1:'${remotePath.replace(/'/g, "'\\'")}'`,
      { timeout: 60000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 上传文件失败: ${err.message}`);
  }
}

// 通过 SSH 删除文件或目录
export async function deleteSshFile(deviceId: string, remotePath: string): Promise<void> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) throw new Error('sshpass 工具未找到');
  const conn = await getConnOrDefault(deviceId);
  try {
    await execPromise(
      `${sshBaseCmd(sshpassPath, conn)} "rm -rf '${remotePath.replace(/'/g, "'\\''")}'"`,
      { timeout: 10000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 删除失败: ${err.message}`);
  }
}

// 通过 SSH 创建目录
export async function createSshDirectory(deviceId: string, remotePath: string): Promise<void> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) throw new Error('sshpass 工具未找到');
  const conn = await getConnOrDefault(deviceId);
  try {
    await execPromise(
      `${sshBaseCmd(sshpassPath, conn)} "mkdir -p '${remotePath.replace(/'/g, "'\\''")}'"`,
      { timeout: 10000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 创建目录失败: ${err.message}`);
  }
}

// 通过 SSH 重命名文件
export async function renameSshFile(deviceId: string, oldPath: string, newPath: string): Promise<void> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) throw new Error('sshpass 工具未找到');
  const conn = await getConnOrDefault(deviceId);
  try {
    await execPromise(
      `${sshBaseCmd(sshpassPath, conn)} "mv '${oldPath.replace(/'/g, "'\\''")}' '${newPath.replace(/'/g, "'\\''")}'"`,
      { timeout: 10000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 重命名失败: ${err.message}`);
  }
}

// 通过 SSH 创建文件
export async function createSshFile(deviceId: string, remotePath: string): Promise<void> {
  const sshpassPath = getSshpassPath();
  if (!sshpassPath) throw new Error('sshpass 工具未找到');
  const conn = await getConnOrDefault(deviceId);
  try {
    await execPromise(
      `${sshBaseCmd(sshpassPath, conn)} "touch '${remotePath.replace(/'/g, "'\\''")}'"`,
      { timeout: 10000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 创建文件失败: ${err.message}`);
  }
}
