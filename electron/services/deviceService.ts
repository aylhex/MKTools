import { exec } from 'node:child_process';
import util from 'node:util';
import { getAdbPath, getIosToolPath } from '../utils/paths';
import { getIosEnv } from '../utils/env';

const execPromise = util.promisify(exec);

export interface Device {
  id: string;
  name: string;
  platform: 'android' | 'ios';
  status: 'online' | 'offline';
  tool?: string;
}

export async function getDevices(): Promise<Device[]> {
    const devices: Device[] = [];
    
    // 1. 获取 Android 设备
    try {
      const adbPath = getAdbPath();
      // 执行 adb devices -l
      const { stdout } = await execPromise(`"${adbPath}" devices -l`);
      const lines = stdout.split('\n');
      // 跳过第一行 "List of devices attached"
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // 解析行: "serial device product:x model:y device:z transport_id:1"
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && parts[1] === 'device') {
          const id = parts[0];
          let name = id;
          // 尝试从 model: 中提取名称
          const modelPart = parts.find(p => p.startsWith('model:'));
          if (modelPart) {
            name = modelPart.split(':')[1].replace(/_/g, ' ');
          }
          
          devices.push({
            id,
            name,
            platform: 'android',
            status: 'online'
          });
        }
      }
    } catch (e) {
      console.error('Failed to get android devices', e);
    }

    // 2. 获取 iOS 设备 (libimobiledevice 优先)
     try {
         // 方案: 尝试 libimobiledevice
         try {
             const ideviceIdPath = getIosToolPath('idevice_id');
             const ideviceInfoPath = getIosToolPath('ideviceinfo');
             
             // 此时 getIosToolPath 已经根据架构返回了正确的二进制路径 (mac-arm64 或 mac-x64)
             // 我们只需要设置正确的环境变量（主要是动态库加载路径）
             const env = getIosEnv(ideviceIdPath); 
             
             // 如果找不到工具，execPromise 会抛出错误，直接跳过
             if (!ideviceIdPath) {
                 throw new Error('idevice_id not found');
             }

             const { stdout } = await execPromise(`"${ideviceIdPath}" -l`, { env });
             const lines = stdout.split('\n');
             for (const line of lines) {
                 const id = line.trim();
                 if (!id) continue;
                 
                 let name = `iOS Device (${id.substring(0, 6)}...)`;
                 try {
                     if (ideviceInfoPath) {
                        const { stdout: nameOut } = await execPromise(`"${ideviceInfoPath}" -u ${id} -k DeviceName`, { env });
                        if (nameOut.trim()) {
                            name = nameOut.trim();
                        }
                     }
                 } catch (e) {}
         
                 devices.push({
                     id,
                     name,
                     platform: 'ios',
                     status: 'online',
                     tool: 'libimobiledevice'
                 });
             }
         } catch (e2) {
             // both failed
         }
      } catch (e) {
      }

    return devices;
}

export async function getAndroidApps(deviceId: string): Promise<{ bundleId: string, name: string }[]> {
  try {
    const adbPath = getAdbPath();
    // List user-installed packages
    const { stdout } = await execPromise(`"${adbPath}" -s "${deviceId}" shell pm list packages -3`);
    const lines = stdout.split('\n');
    const apps: { bundleId: string, name: string }[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Format: package:com.example.app
      if (trimmed.startsWith('package:')) {
        const bundleId = trimmed.substring(8);
        apps.push({
          bundleId,
          name: bundleId // Will be enhanced by Frida
        });
      }
    }
    
    // Sort by bundleId
    return apps.sort((a, b) => a.bundleId.localeCompare(b.bundleId));
  } catch (e: any) {
    throw new Error(`Failed to get Android apps: ${e.message}`);
  }
}

/**
 * 获取某个 Android 应用当前运行的所有进程 PID（含 :xxx 子进程）。
 * 用于日志按包名过滤——由于进程可能重启导致 PID 变化，调用方需定期刷新。
 */
export async function getAndroidPackagePids(deviceId: string, packageName: string): Promise<number[]> {
  const pkg = (packageName || '').trim();
  if (!pkg) return [];

  const adbPath = getAdbPath();
  const pids = new Set<number>();

  try {
    const { stdout } = await execPromise(`"${adbPath}" -s "${deviceId}" shell pidof ${pkg}`);
    stdout.trim().split(/\s+/).forEach(p => {
      const n = parseInt(p, 10);
      if (!isNaN(n)) pids.add(n);
    });
  } catch (e) {
    // pidof 不存在或该应用未运行，交由 ps 兜底
  }

  try {
    const { stdout } = await execPromise(`"${adbPath}" -s "${deviceId}" shell ps -A`);
    const lines = stdout.split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/\s+/);
      if (parts.length < 2) continue;
      const name = parts[parts.length - 1];
      if (name === pkg || name.startsWith(`${pkg}:`)) {
        const pid = parseInt(parts[1], 10);
        const pidFallback = parseInt(parts[0], 10);
        if (!isNaN(pid)) pids.add(pid);
        else if (!isNaN(pidFallback)) pids.add(pidFallback);
      }
    }
  } catch (e) {
    // ps 语法不兼容时忽略
  }

  return Array.from(pids);
}

/**
 * 检测 Android 设备是否已 root（能获得 uid=0 的 shell）。
 * 依次尝试 3 种常见方式：`su 0 id -u` / `su -c "id -u"` / `adb root` 后普通 `id -u`。
 * 只要有一种返回 `0`，即视为已 root。
 */
export async function checkAndroidRoot(deviceId: string): Promise<boolean> {
  const adb = getAdbPath();
  const TIMEOUT = { timeout: 5000 };

  // 方式 1：su 0 id -u（Magisk / SuperSU 常见）
  try {
    const { stdout } = await execPromise(`"${adb}" -s "${deviceId}" shell su 0 id -u`, TIMEOUT);
    if (stdout.trim() === '0') return true;
  } catch { /* try next */ }

  // 方式 2：su -c "id -u"（老式 su）
  try {
    const { stdout } = await execPromise(`"${adb}" -s "${deviceId}" shell 'su -c "id -u"'`, TIMEOUT);
    if (stdout.trim() === '0') return true;
  } catch { /* try next */ }

  // 方式 3：adb root 后 id -u（debug/userdebug 系统）
  try {
    await execPromise(`"${adb}" -s "${deviceId}" root`, TIMEOUT);
    await new Promise(r => setTimeout(r, 1200));
    const { stdout } = await execPromise(`"${adb}" -s "${deviceId}" shell id -u`, TIMEOUT);
    if (stdout.trim() === '0') return true;
  } catch { /* not rooted */ }

  return false;
}

export async function getAndroidAppIcon(deviceId: string, packageName: string): Promise<string | null> {
  try {
    const adbPath = getAdbPath();
    // 1. Get APK path
    const { stdout: pathOut } = await execPromise(`"${adbPath}" -s "${deviceId}" shell pm path ${packageName}`);
    const apkPath = pathOut.trim().replace(/^package:/, '');
    if (!apkPath) return null;

    // 2. List APK contents to find icon (using unzip if available on device, or we assume typical path)
    // Actually, unzip might not be on device.
    // Let's try to pull the APK header? No.
    // Let's try to dump badging via dumpsys?
    // "dumpsys package <pkg>" might give "icon=..."
    // But we need the file.
    
    // Strategy: Try to list files in APK using device's unzip/zipinfo if available
    // Fallback: Guess typical icon paths: res/mipmap-xxxhdpi/ic_launcher.png, res/drawable/icon.png
    
    // Check if unzip exists
    try {
       const { stdout: filesOut } = await execPromise(`"${adbPath}" -s "${deviceId}" shell "unzip -l ${apkPath} | grep -E 'res/.*(ic_launcher|icon).*\.png'"`);
       const lines = filesOut.split('\n');
       // Pick the largest one (likely highest res) or just the first valid one
       // unzip -l output: Length  Date  Time  Name
       // We need to parse it.
       let bestIconPath = '';
       let maxSize = 0;
       
       for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          // 2304  2023-01-01 12:00   res/mipmap-mdpi/ic_launcher.png
          if (parts.length >= 4) {
             const size = parseInt(parts[0]);
             const path = parts[parts.length - 1];
             if (path.endsWith('.png') && size > maxSize) {
                maxSize = size;
                bestIconPath = path;
             }
          }
       }

       if (bestIconPath) {
          // Extract it
          // adb exec-out "unzip -p <apk> <file>" (exec-out is binary safe)
          // But node exec might mess up binary encoding.
          // Better: adb shell "unzip -p <apk> <file> | base64"
          const { stdout: base64Out } = await execPromise(`"${adbPath}" -s "${deviceId}" shell "unzip -p ${apkPath} ${bestIconPath} | base64"`, { maxBuffer: 10 * 1024 * 1024 });
          return base64Out.replace(/\s/g, '');
       }
    } catch (e) {
       // unzip failed or not found
    }
    
    return null;
  } catch (e) {
    console.error(`Failed to get icon for ${packageName}:`, e);
    return null;
  }
}
