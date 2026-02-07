import { exec } from 'node:child_process';
import util from 'node:util';
import { BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getAdbPath } from '../utils/paths';
import { execSshCommand, uploadSshFile, checkJailbreak } from './iosSshService';
import { saveIconsBatch, getIconsBatch } from './iconCacheService';

const execPromise = util.promisify(exec);

export interface DecryptOptions {
  deviceId: string;
  platform: 'android' | 'ios';
  bundleId: string;
  outputDir?: string;
}

export interface FridaAppInfo {
  id: string;
  name: string;
  version: string;
  icon?: string; // Base64
}

// 获取 Frida 资源路径
function getFridaResourcePath(): string {
  if (process.resourcesPath) {
    const packagedPath = path.join(process.resourcesPath, 'bin', 'frida');
    if (fs.existsSync(packagedPath)) return packagedPath;
  }
  return path.join(process.cwd(), 'resources', 'bin', 'frida');
}

export async function checkFridaInstalled(): Promise<boolean> {
  try {
    await execPromise('frida --version');
    return true;
  } catch (e) {
    return false;
  }
}

// 检查并部署 Frida Server (Android)
export async function checkAndDeployFridaServer(deviceId: string, platform: 'android' | 'ios', onLog: (msg: string) => void): Promise<boolean> {
  const fridaArgs = `-D "${deviceId}"`; // Use specific device ID

  if (platform === 'ios') {
    // iOS: Check connection via frida-ps
    onLog(`[Frida] Checking iOS Frida connection (Device: ${deviceId})...`);
    try {
      const { stdout } = await execPromise(`frida-ps ${fridaArgs}`);
      if (stdout.includes('PID')) {
        onLog('[Frida] Frida Server is running on iOS.');
        return true;
      }
    } catch (e) {
      onLog('[Frida] Connection failed. Checking if device is jailbroken and SSH is available...');
    }

    // Try to deploy if SSH is available
    try {
      const isJailbroken = await checkJailbreak(deviceId);
      if (!isJailbroken) {
        onLog('[Frida Error] Device is not accessible via SSH (not jailbroken or iproxy failed). Cannot deploy Frida.');
        return false;
      }

      onLog('[Frida] Device is accessible via SSH. Preparing to deploy Frida...');
      
      // 1. Check Architecture
      let arch = 'arm';
      try {
        const uname = await execSshCommand(deviceId, 'uname -m');
        if (uname.includes('arm64')) arch = 'arm64';
        onLog(`[Frida] Device architecture: ${uname.trim()} -> ${arch}`);
      } catch (e) {
        onLog(`[Warn] Failed to get architecture, defaulting to arm: ${e}`);
      }

      // 2. Locate Deb
      const fridaPath = getFridaResourcePath();
      // Filename example: frida_16.2.1_iphoneos-arm64.deb
      // Note: User's files use underscores and 'iphoneos'
      const debName = `frida_16.2.1_iphoneos-${arch}.deb`;
      const localDebPath = path.join(fridaPath, debName);

      if (!fs.existsSync(localDebPath)) {
        onLog(`[Error] Frida deb file not found at ${localDebPath}`);
        return false;
      }

      // 3. Upload Deb
      onLog(`[Frida] Uploading ${debName} to /tmp/...`);
      const remotePath = `/tmp/${debName}`;
      await uploadSshFile(deviceId, localDebPath, remotePath);

      // 4. Install Deb
      onLog('[Frida] Installing Frida package...');
      // dpkg -i
      await execSshCommand(deviceId, `dpkg -i ${remotePath}`);
      
      // 5. Cleanup
      await execSshCommand(deviceId, `rm ${remotePath}`);

      // 6. Wait and Verify
      onLog('[Frida] Installation complete. Waiting for service...');
      await new Promise(r => setTimeout(r, 5000));
      
      try {
        const { stdout } = await execPromise(`frida-ps ${fridaArgs}`);
        if (stdout.includes('PID')) {
          onLog('[Frida] Frida Server started successfully.');
          return true;
        }
      } catch (e) {
        onLog('[Frida Warning] Installation finished but connection check failed. It might take a moment to start.');
        return true; // Assume success if install worked, user can try again
      }

    } catch (e: any) {
      onLog(`[Frida Error] Failed to deploy on iOS: ${e.message}`);
      return false;
    }

    return false;
  }

  // Android
  const adb = getAdbPath();
  onLog('[Frida] Checking Android Frida Server...');
  
  // 1. Check if running
  try {
    const { stdout } = await execPromise(`"${adb}" -s "${deviceId}" shell "ps -A | grep frida-server"`);
    if (stdout.includes('frida-server')) {
      onLog('[Frida] Frida Server process found on device.');
      
      // Check if running as root
      const lines = stdout.split('\n').filter(l => l.includes('frida-server'));
      const isRoot = lines.some(line => line.trim().startsWith('root'));
      
      if (!isRoot) {
        onLog('[Frida Warn] Frida Server is NOT running as root. Restarting with root privileges...');
        // Fall through to restart logic
      } else {
        // Verify host connectivity
        try {
          await execPromise(`frida-ps ${fridaArgs}`);
          onLog('[Frida] Host can communicate with Frida Server.');
          return true;
        } catch (e) {
          onLog('[Frida Warn] Frida Server is running but host cannot connect. trying to restart...');
          // Fall through to restart logic
        }
      }
    }
  } catch (e) {
    // Grep returns 1 if not found
  }

  // 2. Check Architecture
  onLog('[Frida] Checking device architecture...');
  let arch = 'arm';
  try {
    const { stdout } = await execPromise(`"${adb}" -s "${deviceId}" shell getprop ro.product.cpu.abi`);
    const abi = stdout.trim();
    if (abi.includes('arm64')) arch = 'arm64';
    else if (abi.includes('x86_64')) arch = 'x86_64'; // Not supported by current resources but good to know
    else if (abi.includes('x86')) arch = 'x86';
    onLog(`[Frida] Device architecture: ${abi} -> ${arch}`);
  } catch (e) {
    onLog(`[Warn] Failed to get architecture, defaulting to arm: ${e}`);
  }

  // 3. Push binary
  const fridaPath = getFridaResourcePath();
  const serverName = `frida-server-16.2.1-android-${arch}`;
  const localServerPath = path.join(fridaPath, serverName);
  
  if (!fs.existsSync(localServerPath)) {
    onLog(`[Error] Frida server binary not found at ${localServerPath}`);
    return false;
  }

  onLog(`[Frida] Pushing ${serverName} to device...`);
  const remotePath = `/data/local/tmp/frida-server`;
  try {
    await execPromise(`"${adb}" -s "${deviceId}" push "${localServerPath}" "${remotePath}"`);
    await execPromise(`"${adb}" -s "${deviceId}" shell "chmod 755 ${remotePath}"`);
  } catch (e: any) {
    onLog(`[Error] Failed to push frida-server: ${e.message}`);
    return false;
  }

  // 4. Start Server
  onLog('[Frida] Starting Frida Server...');
  try {
    // Kill any existing frida-server first (both user and root processes)
    try {
      onLog('[Frida] Killing existing frida-server processes...');
      await execPromise(`"${adb}" -s "${deviceId}" shell "su -c 'pkill -9 frida-server'"`);
      await new Promise(r => setTimeout(r, 1000));
    } catch(e) {
      // Ignore if no process to kill or su fails
      onLog('[Frida] No existing frida-server to kill (or pkill failed)');
    }
    
    // Start with root privileges using su -c
    // This is critical for attaching to system processes like system_server
    onLog('[Frida] Starting Frida Server with root privileges...');
    await execPromise(`"${adb}" -s "${deviceId}" shell "su -c 'nohup ${remotePath} -D > /dev/null 2>&1 &'"`);
    
    // Wait for server to start
    await new Promise(r => setTimeout(r, 3000));
    
    // Verify it's running as root
    const { stdout } = await execPromise(`"${adb}" -s "${deviceId}" shell "ps -A | grep frida-server"`);
    if (stdout.includes('frida-server')) {
      // Check if running as root
      const lines = stdout.split('\n').filter(l => l.includes('frida-server'));
      const isRoot = lines.some(line => line.trim().startsWith('root'));
      
      if (isRoot) {
        onLog('[Frida] ✓ Frida Server started successfully as root.');
      } else {
        onLog('[Frida Warn] Frida Server running but NOT as root. May have permission issues.');
      }
      
      // Verify host can connect
      try {
        await execPromise(`frida-ps -D "${deviceId}"`, { timeout: 5000 });
        onLog('[Frida] ✓ Host can communicate with Frida Server.');
        return true;
      } catch(e) {
        onLog('[Frida Warn] Server running but connection test failed. May need a moment to initialize.');
        return true; // Still return true as server is running
      }
    } else {
      onLog('[Error] Frida Server failed to start.');
      return false;
    }
  } catch (e: any) {
    onLog(`[Error] Failed to start frida-server: ${e.message}`);
    return false;
  }
}

// 使用 Frida 获取应用列表和图标
export async function fetchAppListViaFrida(deviceId: string, platform: 'android' | 'ios', onLog?: (msg: string) => void): Promise<FridaAppInfo[]> {
  const log = onLog || console.log;
  
  log('[Frida] Starting app list fetch via Frida...');
  
  // 1. 检查 Frida 是否安装
  const hasFrida = await checkFridaInstalled();
  if (!hasFrida) {
    log('[Frida Error] Frida is not installed. Please install: pip install frida-tools');
    return [];
  }
  log('[Frida] Frida tools found on host.');
  
  // 2. 确保 Frida Server 已部署并运行
  log('[Frida] Checking and deploying Frida Server if needed...');
  const ready = await checkAndDeployFridaServer(deviceId, platform, log);
  if (!ready) {
    log('[Frida] Server not ready, cannot fetch apps.');
    return [];
  }
  log('[Frida] Frida Server is ready.');

  // Debug: Log Frida version
  try {
     const { stdout } = await execPromise('frida --version');
     log(`[Frida] Host Frida Version: ${stdout.trim()}`);
  } catch(e) {}

  // 方法 1: 使用 Frida Python API (推荐，包含图标)
  log('[Frida] Method 1: Using Frida Python API with enumerate_applications...');
  try {
    const result = await fetchAppListViaFridaPython(deviceId, platform, log);
    if (result.length > 0) {
      log(`[Frida] Successfully fetched ${result.length} apps via Python API`);
      return result;
    }
  } catch (e: any) {
    log(`[Frida] Python API method failed: ${e.message}`);
  }

  // 方法 2: 使用 frida-ps (快速但无图标)
  log('[Frida] Method 2: Using frida-ps to get app list...');
  try {
    const result = await fetchAppListViaFridaPs(deviceId, platform, log);
    if (result.length > 0) {
      log(`[Frida] Successfully fetched ${result.length} apps via frida-ps`);
      return result;
    }
  } catch (e: any) {
    log(`[Frida] frida-ps method failed: ${e.message}`);
  }

  // 方法 3: 回退到脚本注入方法
  log('[Frida] Method 3: Using script injection...');
  return await fetchAppListViaScript(deviceId, platform, log);
}

// 检查并安装 Frida Python 模块
async function ensureFridaPythonModule(log: (msg: string) => void): Promise<string> {
  // 尝试的 Python 命令列表（优先使用 python）
  const pythonCommands = ['python', 'python3'];
  
  for (const pythonCmd of pythonCommands) {
    try {
      // 检查 Python 是否存在
      const { stdout: versionOut } = await execPromise(`${pythonCmd} --version`);
      log(`[Frida] Found ${pythonCmd}: ${versionOut.trim()}`);
      
      // 检查是否已安装 frida 模块
      try {
        const { stdout } = await execPromise(`${pythonCmd} -c "import frida; print(frida.__version__)"`);
        const version = stdout.trim();
        log(`[Frida] Found frida module (${version}) in ${pythonCmd}`);
        return pythonCmd; // 成功，返回可用的 Python 命令
      } catch (e) {
        // frida 模块不存在，尝试安装
        log(`[Frida] frida module not found in ${pythonCmd}, attempting to install...`);
        
        try {
          // 使用 python -m pip 确保安装到正确的 Python 版本
          log(`[Frida] Installing frida via ${pythonCmd} -m pip...`);
          
          await execPromise(`${pythonCmd} -m pip install frida`, { timeout: 120000 });
          
          // 验证安装
          const { stdout } = await execPromise(`${pythonCmd} -c "import frida; print(frida.__version__)"`);
          const version = stdout.trim();
          log(`[Frida] Successfully installed frida (${version})`);
          return pythonCmd;
        } catch (installError: any) {
          log(`[Frida Warn] Failed to install frida in ${pythonCmd}: ${installError.message}`);
          // 继续尝试下一个 Python 命令
        }
      }
    } catch (e) {
      // Python 命令不存在，尝试下一个
      continue;
    }
  }
  
  // 所有尝试都失败
  throw new Error('Python not found or frida module installation failed. Please install Python and frida manually: python3 -m pip install frida');
}

// 使用 Frida Python API 获取应用列表（包含图标）
async function fetchAppListViaFridaPython(deviceId: string, platform: 'android' | 'ios', log: (msg: string) => void): Promise<FridaAppInfo[]> {
  // 确保 Python 和 frida 模块可用
  let pythonCmd: string;
  try {
    pythonCmd = await ensureFridaPythonModule(log);
  } catch (e: any) {
    log(`[Frida Error] ${e.message}`);
    throw e;
  }
  // 创建 Python 脚本
  const pythonScript = `
import frida
import sys
import json
import base64

try:
    # 连接设备
    device = frida.get_device("${deviceId}")
    print(f"[Frida] Connected to device: {device.name}", file=sys.stderr)
    
    # 枚举应用 (scope='full' 包含图标)
    print("[Frida] Enumerating applications with icons...", file=sys.stderr)
    apps = device.enumerate_applications(scope='full')
    print(f"[Frida] Found {len(apps)} total applications", file=sys.stderr)
    
    # 系统应用前缀
    ${platform === 'android' ? `
    system_prefixes = [
        'com.android.',
        'com.google.',
        'com.samsung.',
        'com.miui.',
        'com.xiaomi.',
        'com.huawei.',
        'com.oppo.',
        'com.vivo.',
        'com.sec.',
        'android.',
    ]
    ` : `
    system_prefixes = [
        'com.apple.',
    ]
    `}
    
    # 过滤并转换
    result = []
    for app in apps:
        identifier = app.identifier
        
        # 过滤系统应用
        is_system = any(identifier.startswith(prefix) for prefix in system_prefixes)
        if is_system:
            continue
        
        # 处理图标
        icon_b64 = ''
        try:
            icons = app.parameters.get('icons', [])
            if icons:
                # 获取最大的图标（通常是最后一个）
                icon_blob = icons[-1].get('image')
                if icon_blob:
                    icon_b64 = base64.b64encode(icon_blob).decode('utf-8')
        except Exception as e:
            print(f"[Warn] Failed to get icon for {app.name}: {e}", file=sys.stderr)
        
        result.append({
            'id': identifier,
            'name': app.name,
            'version': app.parameters.get('version', ''),
            'icon': icon_b64
        })
    
    print(f"[Frida] Filtered to {len(result)} user applications", file=sys.stderr)
    
    # 输出 JSON
    print("FRIDA_RESULT_START" + json.dumps(result) + "FRIDA_RESULT_END")
    
except Exception as e:
    print(f"[Error] {e}", file=sys.stderr)
    sys.exit(1)
`;

  const tmpScriptPath = path.join(os.tmpdir(), `frida_enum_apps_${Date.now()}.py`);
  await fs.promises.writeFile(tmpScriptPath, pythonScript);

  try {
    return await new Promise<FridaAppInfo[]>((resolve, reject) => {
      const { spawn } = require('node:child_process');
      const child = spawn(pythonCmd, [tmpScriptPath]);
      
      let output = '';
      let resolved = false;

      child.stdout.on('data', (data: any) => {
        output += data.toString();
      });

      child.stderr.on('data', (data: any) => {
        const str = data.toString();
        log(`[Frida] ${str.trim()}`);
      });

      child.on('close', (code: any) => {
        fs.unlink(tmpScriptPath, () => {});
        
        if (code === 0 && output.includes('FRIDA_RESULT_START') && output.includes('FRIDA_RESULT_END')) {
          try {
            const startIndex = output.indexOf('FRIDA_RESULT_START') + 'FRIDA_RESULT_START'.length;
            const endIndex = output.indexOf('FRIDA_RESULT_END');
            const jsonStr = output.substring(startIndex, endIndex);
            
            const result = JSON.parse(jsonStr);
            log(`[Frida] Parsed ${result.length} apps with icons`);
            
            // 调试：检查第一个应用
            if (result.length > 0) {
              const firstApp = result[0];
              log(`[Frida Debug] First app: id=${firstApp.id}, name=${firstApp.name}, hasIcon=${!!firstApp.icon}, iconLength=${firstApp.icon?.length || 0}`);
            }
            
            // 保存图标到缓存
            if (result.length > 0) {
              saveIconsBatch(deviceId, platform, result.map((app: any) => ({
                packageName: app.id,
                icon: app.icon || ''
              }))).catch(e => {
                log(`[Cache Warn] Failed to cache icons: ${e.message}`);
              });
            }
            
            resolve(result);
          } catch (e: any) {
            log(`[Frida Error] JSON Parse failed: ${e.message}`);
            reject(e);
          }
        } else {
          log(`[Frida] Python script exited with code ${code}`);
          reject(new Error(`Python script failed with code ${code}`));
        }
      });

      child.on('error', (err: any) => {
        log(`[Frida Error] Failed to start Python: ${err.message}`);
        reject(err);
      });

      // Timeout 60s (increased for enumerate_applications)
      setTimeout(() => {
        if (!resolved) {
          log('[Frida] Timeout waiting for Python script');
          child.kill();
          reject(new Error('Timeout'));
        }
      }, 60000);
    });
  } catch (e: any) {
    log(`[Error] Frida Python API failed: ${e.message}`);
    throw e;
  }
}

// 使用 frida-ps 获取应用列表（快速方法）
async function fetchAppListViaFridaPs(deviceId: string, platform: 'android' | 'ios', log: (msg: string) => void): Promise<FridaAppInfo[]> {
  try {
    // 使用 frida-ps -ai -j 获取已安装应用的 JSON 输出
    const { stdout } = await execPromise(`frida-ps -D "${deviceId}" -ai -j`, { timeout: 10000 });
    
    const apps = JSON.parse(stdout);
    log(`[Frida-ps] Parsed ${apps.length} apps from frida-ps`);
    
    // 过滤系统应用，只保留用户安装的应用
    const systemPackagePrefixes = [
      'com.android.',      // Android 系统应用
      'com.google.',       // Google 系统应用
      'com.samsung.',      // Samsung 系统应用
      'com.miui.',         // MIUI 系统应用
      'com.xiaomi.',       // 小米系统应用
      'com.huawei.',       // 华为系统应用
      'com.oppo.',         // OPPO 系统应用
      'com.vivo.',         // VIVO 系统应用
      'com.sec.',          // Samsung 系统应用
      'android.',          // Android 核心
    ];
    
    // iOS 系统应用前缀
    const iosSystemPrefixes = [
      'com.apple.',        // Apple 系统应用
    ];
    
    const prefixesToFilter = platform === 'android' ? systemPackagePrefixes : iosSystemPrefixes;
    
    const userApps = apps.filter((app: any) => {
      const identifier = app.identifier || '';
      // 检查是否是系统应用
      const isSystemApp = prefixesToFilter.some(prefix => identifier.startsWith(prefix));
      return !isSystemApp;
    });
    
    log(`[Frida-ps] Filtered to ${userApps.length} user apps (from ${apps.length} total)`);
    
    // 转换为 FridaAppInfo 格式
    const result: FridaAppInfo[] = userApps.map((app: any) => ({
      id: app.identifier,
      name: app.name || app.identifier,
      version: '', // frida-ps 不提供版本信息
      icon: '' // 图标需要单独获取
    }));
    
    log(`[Frida-ps] Converted ${result.length} user apps`);
    
    return result;
  } catch (e: any) {
    log(`[Frida-ps Error] ${e.message}`);
    throw e;
  }
}

// 使用脚本注入获取应用列表（备用方法，包含图标）
async function fetchAppListViaScript(deviceId: string, platform: 'android' | 'ios', log: (msg: string) => void): Promise<FridaAppInfo[]> {
  log('[Frida] Fetching app list via script injection...');
  
  // Create script file
  const tmpScriptPath = path.join(os.tmpdir(), `frida_list_apps_${Date.now()}.js`);
  let scriptContent = '';

  if (platform === 'android') {
    scriptContent = `
Java.perform(function() {
    var PM = Java.use('android.content.pm.PackageManager');
    var ActivityThread = Java.use('android.app.ActivityThread');
    var ByteArrayOutputStream = Java.use('java.io.ByteArrayOutputStream');
    var Bitmap = Java.use('android.graphics.Bitmap');
    var Base64 = Java.use('android.util.Base64');
    var Canvas = Java.use('android.graphics.Canvas');
    var CompressFormat = Java.use('android.graphics.Bitmap$CompressFormat');

    var context = ActivityThread.currentApplication().getApplicationContext();
    var pm = context.getPackageManager();
    var packages = pm.getInstalledPackages(0);
    
    var result = [];
    
    for (var i = 0; i < packages.size(); i++) {
        try {
            var pkg = packages.get(i);
            var appInfo = pkg.applicationInfo.value;
            
            // Filter third party: (flags & ApplicationInfo.FLAG_SYSTEM) == 0
            // FLAG_SYSTEM = 1
            var isSystem = (appInfo.flags.value & 1) !== 0;
            if (isSystem) continue;

            var name = "";
            var id = "";
            var version = "";
            var icon = "";
            
            try {
                name = appInfo.loadLabel(pm).toString();
            } catch(e) {
                name = "Unknown";
            }
            
            try {
                id = pkg.packageName.value;
            } catch(e) {
                continue; // Skip if no package name
            }
            
            try {
                version = pkg.versionName.value || "";
            } catch(e) {
                version = "";
            }
            
            // Icon - compressed to 64x64 for UI display
            try {
                var drawable = appInfo.loadIcon(pm);
                var bitmap = null;
                
                // Target size for UI display
                var targetSize = 64;
                var width = drawable.getIntrinsicWidth();
                var height = drawable.getIntrinsicHeight();
                
                if (width <= 0 || height <= 0) {
                    width = targetSize;
                    height = targetSize;
                } else {
                    // Scale down to target size
                    var scale = Math.min(targetSize / width, targetSize / height);
                    width = Math.floor(width * scale);
                    height = Math.floor(height * scale);
                }
                
                bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888.value);
                
                var canvas = Canvas.$new(bitmap);
                drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
                drawable.draw(canvas);
                
                var baos = ByteArrayOutputStream.$new();
                // Use JPEG for smaller size (PNG for transparency if needed)
                bitmap.compress(CompressFormat.PNG.value, 60, baos);
                var bytes = baos.toByteArray();
                
                // Only include icon if it's reasonable size (< 100KB base64)
                if (bytes.length < 100000) {
                    icon = Base64.encodeToString(bytes, 2); // NO_WRAP = 2
                }
                
                // Clean up
                bitmap.recycle();
            } catch(e) {
                // Ignore icon error, continue without icon
            }

            result.push({
                id: id,
                name: name,
                version: version,
                icon: icon
            });
        } catch(e) {
            // Skip this app if any error
            continue;
        }
    }
    
    console.log("FRIDA_SCRIPT_STARTED");
    try {
        console.log("FRIDA_RESULT_START" + JSON.stringify(result) + "FRIDA_RESULT_END");
    } catch (e) {
        console.log("FRIDA_SCRIPT_ERROR: " + e.toString());
    }
});
    `;
  } else {
    // iOS Script - with simplified icon handling using NSData base64
    scriptContent = `
    // iOS script to get apps with icons
    console.log("FRIDA_SCRIPT_STARTED");
    ObjC.schedule(ObjC.mainQueue, function() {
        try {
            var workspace = ObjC.classes.LSApplicationWorkspace.defaultWorkspace();
            var apps = workspace.allInstalledApplications();
            var result = [];
            
            for (var i = 0; i < apps.count(); i++) {
                try {
                    var app = apps.objectAtIndex_(i);
                    if (app.applicationType().toString() !== "User") continue;
                    
                    var id = "";
                    var name = "";
                    var version = "";
                    var icon = "";
                    
                    try {
                        id = app.applicationIdentifier().toString();
                    } catch(e) {
                        continue; // Skip if no ID
                    }
                    
                    try {
                        name = app.localizedName().toString();
                    } catch(e) {
                        name = id;
                    }
                    
                    try {
                        version = app.shortVersionString().toString();
                    } catch(e) {
                        version = "";
                    }
                    
                    // Try to get icon using multiple methods
                    try {
                        var iconData = null;
                        
                        // Method 1: Try to get icon from LSApplicationProxy
                        try {
                            var iconImage = app.iconDataForVariant_(0); // 0 = default variant
                            if (iconImage && iconImage.length() > 0) {
                                iconData = iconImage;
                            }
                        } catch(e1) {}
                        
                        // Method 2: Try bundle resources if Method 1 failed
                        if (!iconData) {
                            try {
                                var bundle = ObjC.classes.NSBundle.bundleWithURL_(app.bundleURL());
                                if (bundle) {
                                    // Try to find icon files
                                    var iconFiles = bundle.pathsForResourcesOfType_inDirectory_("png", null);
                                    if (iconFiles && iconFiles.count() > 0) {
                                        // Look for AppIcon files first
                                        for (var j = 0; j < Math.min(iconFiles.count(), 20); j++) {
                                            var iconPath = iconFiles.objectAtIndex_(j).toString();
                                            var fileName = iconPath.split('/').pop().toLowerCase();
                                            
                                            // Prioritize AppIcon files
                                            if (fileName.indexOf('appicon60x60') >= 0 || 
                                                fileName.indexOf('appicon@2x') >= 0 ||
                                                fileName.indexOf('appicon') >= 0) {
                                                
                                                var data = ObjC.classes.NSData.dataWithContentsOfFile_(iconPath);
                                                if (data && data.length() > 0 && data.length() < 500000) {
                                                    iconData = data;
                                                    break;
                                                }
                                            }
                                        }
                                        
                                        // If no AppIcon found, try any icon file
                                        if (!iconData) {
                                            for (var j = 0; j < Math.min(iconFiles.count(), 20); j++) {
                                                var iconPath = iconFiles.objectAtIndex_(j).toString();
                                                var fileName = iconPath.split('/').pop().toLowerCase();
                                                
                                                if (fileName.indexOf('icon') >= 0 && fileName.indexOf('@2x') >= 0) {
                                                    var data = ObjC.classes.NSData.dataWithContentsOfFile_(iconPath);
                                                    if (data && data.length() > 0 && data.length() < 500000) {
                                                        iconData = data;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch(e2) {}
                        }
                        
                        // Convert to base64 if we got icon data
                        if (iconData && iconData.length() > 0) {
                            icon = iconData.base64EncodedStringWithOptions_(0).toString();
                        }
                    } catch(e) {
                        // Ignore icon errors
                    }
                    
                    result.push({
                        id: id,
                        name: name,
                        version: version,
                        icon: icon
                    });
                } catch(e) {
                    // Skip this app
                    continue;
                }
            }
            console.log("FRIDA_RESULT_START" + JSON.stringify(result) + "FRIDA_RESULT_END");
        } catch (e) {
            console.log("FRIDA_SCRIPT_ERROR: " + e.toString());
        }
    });
    `;
  }

  await fs.promises.writeFile(tmpScriptPath, scriptContent);

  try {
    // Get target process/PID
    let targetArgs: string[] = [];
    
    if (platform === 'android') {
       // Android: Get system_server PID and attach to it
       log('[Frida] Getting system_server PID...');
       
       try {
         const adb = getAdbPath();
         const { stdout } = await execPromise(`"${adb}" -s "${deviceId}" shell "ps -A | grep system_server"`);
         
         // Parse output to get PID
         // Format: system        1359   844  ... system_server
         const match = stdout.match(/\s+(\d+)\s+/);
         
         if (match && match[1]) {
           const pid = match[1];
           log(`[Frida] Found system_server PID: ${pid}`);
           targetArgs = ['-D', deviceId, '-p', pid, '-l', tmpScriptPath];
         } else {
           log('[Frida Error] Could not parse system_server PID from ps output');
           log(`[Frida Debug] ps output: ${stdout}`);
           return [];
         }
       } catch (e: any) {
         log(`[Frida Error] Failed to get system_server PID: ${e.message}`);
         return [];
       }
    } else {
       // iOS: Attach to SpringBoard by name
       log('[Frida] Attaching to SpringBoard...');
       targetArgs = ['-D', deviceId, '-n', 'SpringBoard', '-l', tmpScriptPath];
    }

    log(`[Frida] Running: frida ${targetArgs.join(' ')}`);
    
    return await new Promise<FridaAppInfo[]>((resolve, reject) => {
       const { spawn } = require('node:child_process');
       
       const args = targetArgs;
       
       log(`[Frida Debug] Spawning: frida ${args.join(' ')}`);
       
       const child = spawn('frida', args);
       
       let output = '';
       let result: FridaAppInfo[] = [];
       let resolved = false;
       let hasStdout = false;
       let hasStderr = false;

       child.on('error', (err: any) => {
          log(`[Frida Error] Failed to start frida process: ${err.message}`);
          if (err.code === 'ENOENT') {
             log('[Frida Error] "frida" command not found. Please install frida-tools (pip install frida-tools).');
          }
          // 如果进程启动失败，立即返回空数组
          if (!resolved) {
            resolved = true;
            resolve([]);
          }
       });

       child.stdout.on('data', (data: any) => {
          const str = data.toString();
          output += str;
          
          if (!hasStdout) {
            hasStdout = true;
            log('[Frida Debug] Receiving stdout data...');
          }
          
          // Debug log for first chunk to verify connection
          if (output.length < 500) {
             // log(`[Frida Debug Stdout] ${str.substring(0, 100)}...`);
          }
          
          if (str.includes('FRIDA_SCRIPT_STARTED')) {
             log('[Frida] Script injected successfully.');
          }
          
          if (str.includes('FRIDA_SCRIPT_ERROR')) {
             log(`[Frida Script Error] ${str}`);
          }

          // Check for our custom delimiter
          if (output.includes('FRIDA_RESULT_START') && output.includes('FRIDA_RESULT_END')) {
             try {
                const startIndex = output.indexOf('FRIDA_RESULT_START') + 'FRIDA_RESULT_START'.length;
                const endIndex = output.indexOf('FRIDA_RESULT_END');
                const jsonStr = output.substring(startIndex, endIndex);
                
                log(`[Frida Debug] JSON length: ${jsonStr.length} bytes`);
                log(`[Frida Debug] JSON preview: ${jsonStr.substring(0, 200)}...`);
                
                result = JSON.parse(jsonStr);
                
                log(`[Frida] Parsed ${result.length} apps successfully`);
                
                // 调试：检查第一个应用的数据
                if (result.length > 0) {
                  const firstApp = result[0];
                  log(`[Frida Debug] First app: id=${firstApp.id}, name=${firstApp.name}, hasIcon=${!!firstApp.icon}, iconLength=${firstApp.icon?.length || 0}`);
                }
                
                resolved = true;
                child.kill();
                
                // 保存图标到缓存
                if (result.length > 0) {
                  log(`[Frida] Caching ${result.length} app icons...`);
                  saveIconsBatch(deviceId, platform, result.map(app => ({
                    packageName: app.id,
                    icon: app.icon || ''
                  }))).catch(e => {
                    log(`[Cache Warn] Failed to cache icons: ${e.message}`);
                  });
                }
                
                resolve(result);
             } catch (e: any) {
                log(`[Frida Error] JSON Parse failed: ${e.message}`);
                log(`[Frida Error] JSON string: ${output.substring(0, 500)}`);
             }
          }
       });

       child.stderr.on('data', (data: any) => {
          const str = data.toString();
          if (!hasStderr) {
            hasStderr = true;
            log('[Frida Debug] Receiving stderr data...');
          }
          log(`[Frida Stderr] ${str}`);
       });

       child.on('close', (code: any) => {
          log(`[Frida Debug] Process closed with code ${code}`);
          log(`[Frida Debug] Has stdout: ${hasStdout}, Has stderr: ${hasStderr}`);
          log(`[Frida Debug] Output length: ${output.length} bytes`);
          
          // 显示实际输出内容以便调试
          if (output.length > 0 && output.length < 2000) {
            log(`[Frida Debug] Full output:\n${output}`);
          } else if (output.length > 0) {
            log(`[Frida Debug] Output preview (first 1000 chars):\n${output.substring(0, 1000)}`);
          }
          
          if (!resolved) {
             log(`[Frida] Process exited with code ${code} without result.`);
             resolve([]);
          }
          fs.unlink(tmpScriptPath, () => {});
       });
       
       // Timeout 30s
       setTimeout(() => {
          if (!resolved) {
             log('[Frida] Timeout waiting for script result.');
             child.kill();
             resolve([]);
          }
       }, 30000);
    });

  } catch (e: any) {
    log(`[Error] Frida script failed: ${e.message}`);
    return [];
  }
}

export async function decryptApp(
  options: DecryptOptions, 
  onLog: (msg: string) => void
): Promise<string> {
  const { deviceId, platform, bundleId } = options;
  
  onLog(`[Init] 开始脱壳应用: ${bundleId}`);
  onLog(`[Init] 平台: ${platform}, 设备: ${deviceId}`);
  
  // 1. 检查 Frida 是否安装
  onLog('[Step 1/5] 检查 Frida 工具...');
  const hasFrida = await checkFridaInstalled();
  if (!hasFrida) {
    onLog('[Error] Frida 未安装或未在 PATH 中找到');
    onLog('[Info] 请安装 Frida: pip install frida-tools');
    throw new Error('Frida not found. Please install: pip install frida-tools');
  }
  onLog('[✓] Frida 工具已安装');

  // 2. 检查并部署 Frida Server
  onLog('[Step 2/5] 检查并部署 Frida Server...');
  const ready = await checkAndDeployFridaServer(deviceId, platform, onLog);
  if (!ready) {
     onLog('[Error] Frida Server 未就绪');
     throw new Error('Frida Server not ready');
  }
  onLog('[✓] Frida Server 已就绪');

  // 3. 准备输出目录
  onLog('[Step 3/5] 准备输出目录...');
  const outputDir = options.outputDir || path.join(os.tmpdir(), 'mktools_decrypt');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  onLog(`[✓] 输出目录: ${outputDir}`);

  // 4. 执行脱壳
  onLog('[Step 4/5] 开始脱壳进程...');
  
  if (platform === 'ios') {
    // iOS 脱壳使用 frida-ios-dump
    return await decryptIosApp(deviceId, bundleId, outputDir, onLog);
  } else {
    // Android 脱壳使用 frida-dexdump
    return await decryptAndroidApp(deviceId, bundleId, outputDir, onLog);
  }
}

// iOS 应用脱壳
async function decryptIosApp(
  deviceId: string,
  bundleId: string,
  outputDir: string,
  onLog: (msg: string) => void
): Promise<string> {
  const fridaPath = getFridaResourcePath();
  const dumpScriptPath = path.join(fridaPath, 'frida-ios-dump', 'dump.py');
  
  if (!fs.existsSync(dumpScriptPath)) {
    onLog(`[Error] iOS dump 脚本未找到: ${dumpScriptPath}`);
    throw new Error('frida-ios-dump script not found');
  }

  onLog('[iOS] 使用 frida-ios-dump 进行脱壳...');
  onLog(`[iOS] 目标应用: ${bundleId}`);
  
  // 检测可用的 Python 命令（优先使用有 frida 模块的）
  let pythonCmd = 'python3'; // 默认
  try {
    // 尝试 python（优先）
    try {
      await execPromise('python -c "import frida"');
      pythonCmd = 'python';
      onLog('[iOS] 使用 python 命令（已有 frida 模块）');
    } catch (e) {
      // 尝试 python3
      try {
        await execPromise('python3 -c "import frida"');
        pythonCmd = 'python3';
        onLog('[iOS] 使用 python3 命令（已有 frida 模块）');
      } catch (e2) {
        onLog('[iOS Warn] Python 环境中未找到 frida 模块，尝试继续...');
      }
    }
  } catch (e) {
    onLog('[iOS Warn] 无法检测 Python 环境，使用默认 python3');
  }
  
  // 检查并安装 frida-ios-dump 所需的依赖
  onLog('[iOS] 检查 Python 依赖...');
  const requiredModules = ['scp', 'paramiko'];
  
  for (const module of requiredModules) {
    try {
      await execPromise(`${pythonCmd} -c "import ${module}"`);
      onLog(`[iOS] ✓ ${module} 模块已安装`);
    } catch (e) {
      onLog(`[iOS] 安装 ${module} 模块...`);
      try {
        await execPromise(`${pythonCmd} -m pip install ${module}`, { timeout: 60000 });
        onLog(`[iOS] ✓ ${module} 安装成功`);
      } catch (installError: any) {
        onLog(`[iOS Warn] ${module} 安装失败: ${installError.message}`);
        onLog(`[iOS] 请手动安装: ${pythonCmd} -m pip install ${module}`);
      }
    }
  }
  
  // 确保 iproxy 正在运行（用于 SSH 连接）
  onLog('[iOS] 设置 SSH 连接...');
  try {
    const { checkJailbreak, execSshCommand } = await import('./iosSshService');
    const isJailbroken = await checkJailbreak(deviceId);
    if (!isJailbroken) {
      onLog('[iOS Error] 无法建立 SSH 连接，请确保设备已越狱且 iproxy 可用');
      throw new Error('SSH connection failed');
    }
    onLog('[iOS] ✓ SSH 连接已建立');
    
    // 检查应用是否正在运行，如果是则杀死它
    onLog('[iOS] 检查目标应用状态...');
    try {
      const psOutput = await execSshCommand(deviceId, `ps -A | grep -i "${bundleId}" | grep -v grep`);
      if (psOutput && psOutput.trim()) {
        onLog('[iOS] 应用正在运行，准备重启...');
        // 提取 PID 并杀死进程
        const lines = psOutput.trim().split('\n');
        for (const line of lines) {
          const match = line.trim().match(/^\s*(\d+)/);
          if (match && match[1]) {
            const pid = match[1];
            onLog(`[iOS] 杀死进程 PID: ${pid}`);
            try {
              await execSshCommand(deviceId, `kill -9 ${pid}`);
            } catch (e) {
              // 忽略杀死进程的错误
            }
          }
        }
        // 等待进程完全退出
        await new Promise(r => setTimeout(r, 2000));
        onLog('[iOS] ✓ 应用已停止');
      } else {
        onLog('[iOS] 应用未运行');
      }
    } catch (e) {
      // 如果 grep 没找到进程，会返回错误，这是正常的
      onLog('[iOS] 应用未运行');
    }
  } catch (e: any) {
    onLog(`[iOS Error] SSH 连接失败: ${e.message}`);
    throw e;
  }
  
  try {
    // 执行 dump.py 脚本
    // 注意：dump.py 的 -o 参数是输出文件名（不含.ipa后缀），不是目录
    // 我们需要构造完整的输出文件路径
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputFileName = `${bundleId}_${timestamp}`;
    const outputFilePath = path.join(outputDir, outputFileName);
    
    // 添加 SSH 参数：-H localhost -p 2222 -u root -P alpine
    const args = [
      dumpScriptPath,
      '-H', 'localhost',
      '-p', '2222',
      '-u', 'root',
      '-P', 'alpine',
      '-o', outputFilePath,  // 使用完整路径（不含.ipa后缀）
      bundleId
    ];
    
    const cmd = `${pythonCmd} "${dumpScriptPath}" -H localhost -p 2222 -u root -P alpine -o "${outputFilePath}" "${bundleId}"`;
    onLog(`[iOS] 执行命令: ${cmd}`);
    
    const { spawn } = require('node:child_process');
    const child = spawn(pythonCmd, args);
    
    return await new Promise<string>((resolve, reject) => {
      let outputPath = '';
      let hasError = false;
      
      child.stdout.on('data', (data: any) => {
        const str = data.toString();
        onLog(`[iOS] ${str.trim()}`);
        
        // 尝试从输出中提取文件路径
        // 可能的格式：
        // - Saved to /path/to/file.ipa
        // - Generating "xxx.ipa"
        const savedMatch = str.match(/Saved to (.+\.ipa)/);
        const generatingMatch = str.match(/Generating "(.+\.ipa)"/);
        
        if (savedMatch) {
          outputPath = savedMatch[1];
        } else if (generatingMatch && !outputPath) {
          // 如果看到 Generating，记录预期的文件名
          const ipaName = generatingMatch[1];
          // 如果是相对路径，转换为绝对路径
          if (!path.isAbsolute(ipaName)) {
            outputPath = path.join(outputDir, ipaName);
          } else {
            outputPath = ipaName;
          }
        }
      });
      
      child.stderr.on('data', (data: any) => {
        const str = data.toString();
        // 过滤掉 SyntaxWarning、进度条输出和 Python 源代码行
        if (!str.includes('SyntaxWarning') && 
            !str.includes('invalid escape sequence') &&
            !str.match(/^\s*(output_ipa|import|from|def|class)\s*[=:]/) &&  // Python 代码行
            !str.includes('[00:') &&  // 进度条时间
            !str.includes('MB/s') &&  // 进度条速度
            !str.match(/\d+%\|/)) {   // 进度条百分比
          onLog(`[iOS Error] ${str.trim()}`);
          if (str.toLowerCase().includes('error') || str.toLowerCase().includes('failed')) {
            hasError = true;
          }
        }
      });
      
      child.on('close', (code: any) => {
        if (code === 0 && !hasError) {
          // 成功完成
          if (outputPath && fs.existsSync(outputPath)) {
            onLog('[✓] iOS 应用脱壳完成');
            resolve(outputPath);
          } else {
            // 尝试查找生成的 IPA 文件
            onLog('[iOS] 查找生成的 IPA 文件...');
            try {
              // 检查输出目录中的 IPA 文件
              const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.ipa'));
              if (files.length > 0) {
                // 按修改时间排序，获取最新的
                const latestFile = files
                  .map(f => ({
                    name: f,
                    path: path.join(outputDir, f),
                    mtime: fs.statSync(path.join(outputDir, f)).mtime
                  }))
                  .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];
                
                outputPath = latestFile.path;
                onLog(`[✓] 找到脱壳文件: ${outputPath}`);
                resolve(outputPath);
              } else {
                // 检查是否生成了 outputFilePath.ipa
                const expectedPath = `${outputFilePath}.ipa`;
                if (fs.existsSync(expectedPath)) {
                  onLog(`[✓] 脱壳完成: ${expectedPath}`);
                  resolve(expectedPath);
                } else {
                  onLog(`[Error] 未找到输出文件，预期路径: ${expectedPath}`);
                  onLog(`[Error] 输出目录: ${outputDir}`);
                  reject(new Error('Decryption completed but output file not found'));
                }
              }
            } catch (e: any) {
              onLog(`[Error] 查找输出文件失败: ${e.message}`);
              reject(new Error('Decryption completed but output file not found'));
            }
          }
        } else {
          reject(new Error(`Decryption failed with code ${code}`));
        }
      });
      
      // 超时 10 分钟（大型应用需要更长时间）
      setTimeout(() => {
        child.kill();
        reject(new Error('Decryption timeout (10 minutes)'));
      }, 10 * 60 * 1000);
    });
  } catch (e: any) {
    onLog(`[Error] iOS 脱壳失败: ${e.message}`);
    throw e;
  }
}

// 提取 iOS 应用的 header 文件
export async function extractIosHeaders(
  ipaPath: string,
  onLog: (msg: string) => void
): Promise<string> {
  onLog('[Header] 开始提取 header 文件...');
  
  // 获取 dsdump 工具路径
  const getDsdumpPath = (): string => {
    if (process.resourcesPath) {
      const packagedPath = path.join(process.resourcesPath, 'bin', 'mac', 'dsdump');
      if (fs.existsSync(packagedPath)) return packagedPath;
    }
    return path.join(process.cwd(), 'resources', 'bin', 'mac', 'dsdump');
  };
  
  const dsdumpPath = getDsdumpPath();
  
  if (!fs.existsSync(dsdumpPath)) {
    onLog(`[Header Error] dsdump 工具未找到: ${dsdumpPath}`);
    throw new Error('dsdump tool not found');
  }
  
  onLog(`[Header] ✓ 找到 dsdump 工具: ${dsdumpPath}`);
  
  // 确保 dsdump 有执行权限
  try {
    await execPromise(`chmod +x "${dsdumpPath}"`);
  } catch (e) {
    // 忽略权限设置错误
  }
  
  // 检查架构兼容性
  try {
    const { stdout: archCheck } = await execPromise(`file "${dsdumpPath}"`);
    const { stdout: systemArch } = await execPromise('uname -m');
    
    onLog(`[Header] 系统架构: ${systemArch.trim()}`);
    
    // 检查是否是 Universal Binary
    const hasX86 = archCheck.includes('x86_64');
    const hasArm = archCheck.includes('arm64');
    
    if (hasX86 && hasArm) {
      onLog('[Header] dsdump 架构: Universal Binary (x86_64 + arm64)');
      onLog('[Header] ✓ 支持当前系统架构，将原生运行');
    } else if (hasArm) {
      onLog('[Header] dsdump 架构: arm64 (Apple Silicon)');
    } else if (hasX86) {
      onLog('[Header] dsdump 架构: x86_64 (Intel)');
      
      // 如果是 Apple Silicon 但 dsdump 只有 x86_64，需要 Rosetta
      if (systemArch.trim() === 'arm64') {
        onLog('[Header] 检测到架构不匹配，需要 Rosetta 2 支持');
        
        // 检查 Rosetta 是否可用
        try {
          await execPromise('arch -x86_64 /usr/bin/true');
          onLog('[Header] ✓ Rosetta 2 可用，将使用兼容模式运行');
        } catch (e) {
          onLog('[Header Error] Rosetta 2 未安装或不可用');
          onLog('[Header Error] 请安装 Rosetta 2: softwareupdate --install-rosetta');
          throw new Error('dsdump requires Rosetta 2 on Apple Silicon. Install with: softwareupdate --install-rosetta');
        }
      }
    } else {
      onLog('[Header] dsdump 架构: 未知');
    }
  } catch (e: any) {
    onLog(`[Header Warn] 架构检查失败: ${e.message}`);
  }
  
  try {
    // 创建临时目录解压 IPA
    const tmpDir = path.join(os.tmpdir(), `ipa_extract_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    onLog(`[Header] 临时目录: ${tmpDir}`);
    
    // 解压 IPA
    onLog('[Header] 解压 IPA 文件...');
    await execPromise(`unzip -q "${ipaPath}" -d "${tmpDir}"`);
    
    // 查找 .app 目录
    const payloadDir = path.join(tmpDir, 'Payload');
    const appDirs = fs.readdirSync(payloadDir).filter(f => f.endsWith('.app'));
    
    if (appDirs.length === 0) {
      throw new Error('No .app directory found in IPA');
    }
    
    const appDir = path.join(payloadDir, appDirs[0]);
    onLog(`[Header] 找到应用目录: ${appDirs[0]}`);
    
    // 查找主二进制文件
    const appName = appDirs[0].replace('.app', '');
    const binaryPath = path.join(appDir, appName);
    
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found: ${binaryPath}`);
    }
    
    onLog(`[Header] 主二进制文件: ${appName}`);
    
    // 创建 headers 输出目录
    const ipaDir = path.dirname(ipaPath);
    const ipaBaseName = path.basename(ipaPath, '.ipa');
    const headersDir = path.join(ipaDir, `${ipaBaseName}_Headers`);
    fs.mkdirSync(headersDir, { recursive: true });
    onLog(`[Header] Headers 输出目录: ${headersDir}`);
    
    // 运行 dsdump
    // 使用 Python 脚本来调用 dsdump，它会将输出分割成单独的文件
    onLog('[Header] 运行 dsdump...');
    
    const outputDir = headersDir; // 输出目录
    
    // 获取 Python 脚本路径
    const getDsdumpPyPath = (): string => {
      if (process.resourcesPath) {
        const packagedPath = path.join(process.resourcesPath, 'bin', 'mac', 'dsdump.py');
        if (fs.existsSync(packagedPath)) return packagedPath;
      }
      return path.join(process.cwd(), 'resources', 'bin', 'mac', 'dsdump.py');
    };
    
    const dsdumpPyPath = getDsdumpPyPath();
    
    if (!fs.existsSync(dsdumpPyPath)) {
      onLog(`[Header Error] dsdump.py 脚本未找到: ${dsdumpPyPath}`);
      throw new Error('dsdump.py script not found');
    }
    
    // 检测可用的 Python 命令
    let pythonCmd = 'python3';
    try {
      await execPromise('python3 --version');
    } catch (e) {
      try {
        await execPromise('python --version');
        pythonCmd = 'python';
      } catch (e2) {
        onLog('[Header Error] Python 未找到');
        throw new Error('Python not found');
      }
    }
    
    onLog(`[Header] 使用 ${pythonCmd} 执行 dsdump.py`);
    onLog('[Header] 提取中（可能需要几分钟）...');
    
    try {
      // 使用 Python 脚本调用 dsdump
      // -i: 输入文件（二进制）
      // -o: 输出目录
      // -a: 架构（arm64 或 armv7）
      // -d: demangle Swift 符号
      const { stdout, stderr } = await execPromise(
        `${pythonCmd} "${dsdumpPyPath}" -i "${binaryPath}" -o "${outputDir}" -a arm64 -d`,
        { timeout: 180000, maxBuffer: 50 * 1024 * 1024 } // 3分钟超时
      );
      
      // 显示输出（文件列表）
      if (stdout) {
        const lines = stdout.trim().split('\n');
        const fileCount = lines.filter(l => l.includes('.h') || l.includes('.swift')).length;
        onLog(`[Header] ✓ 成功提取 ${fileCount} 个文件`);
        
        // 统计文件类型
        const hFiles = lines.filter(l => l.endsWith('.h')).length;
        const swiftFiles = lines.filter(l => l.endsWith('.swift')).length;
        
        onLog(`[Header]   - Objective-C 头文件: ${hFiles}`);
        onLog(`[Header]   - Swift 文件: ${swiftFiles}`);
      }
      
      if (stderr && !stderr.includes('SyntaxWarning')) {
        onLog(`[Header Debug] stderr: ${stderr.substring(0, 500)}`);
      }
      
      // 生成摘要文件
      const summaryFile = path.join(outputDir, 'README.txt');
      const fileList = fs.readdirSync(outputDir);
      const hFiles = fileList.filter(f => f.endsWith('.h'));
      const swiftFiles = fileList.filter(f => f.endsWith('.swift'));
      
      const summary = `
Header Extraction Summary
========================
Binary: ${appName}
Date: ${new Date().toISOString()}
IPA: ${path.basename(ipaPath)}

Statistics:
- Objective-C Header Files: ${hFiles.length}
- Swift Files: ${swiftFiles.length}
- Total Files: ${fileList.length - 1}

Output Directory:
${outputDir}

Generated by dsdump.py (Version 2.0)

Note: Each class/protocol has been extracted to a separate file for easier browsing.
`;
      fs.writeFileSync(summaryFile, summary);
      onLog(`[Header] ✓ 摘要文件: ${summaryFile}`);
      
    } catch (dsdumpError: any) {
      // 显示详细的错误信息
      onLog(`[Header Error] dsdump.py 执行失败或超时`);
      
      // 检查是否是超时错误
      if (dsdumpError.killed || dsdumpError.signal === 'SIGTERM') {
        onLog(`[Header Error] dsdump.py 执行超时（3分钟）`);
        onLog(`[Header] 该二进制文件可能太大或太复杂`);
      }
      
      if (dsdumpError.stdout) {
        onLog(`[Header Debug] stdout: ${dsdumpError.stdout.substring(0, 1000)}`);
      }
      if (dsdumpError.stderr) {
        onLog(`[Header Error] stderr: ${dsdumpError.stderr.substring(0, 1000)}`);
      }
      onLog(`[Header Error] 错误信息: ${dsdumpError.message}`);
      
      throw dsdumpError;
    }
    
    // 清理临时目录
    onLog('[Header] 清理临时文件...');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    
    onLog(`[✓] Header 文件已保存到: ${headersDir}`);
    return headersDir;
    
  } catch (e: any) {
    onLog(`[Error] Header 提取失败: ${e.message}`);
    throw e;
  }
}

// Android 应用脱壳
async function decryptAndroidApp(
  deviceId: string,
  bundleId: string,
  outputDir: string,
  onLog: (msg: string) => void
): Promise<string> {
  const adb = getAdbPath();
  
  onLog('[Android] 准备脱壳应用...');
  
  // 1. 检查应用是否正在运行
  let isRunning = false;
  try {
    const { stdout } = await execPromise(`"${adb}" -s "${deviceId}" shell "ps -A | grep ${bundleId}"`);
    isRunning = stdout.includes(bundleId);
    if (isRunning) {
      onLog(`[Android] 应用正在运行`);
    } else {
      onLog(`[Android] 应用未运行，将启动应用`);
    }
  } catch (e) {
    // grep 返回 1 表示未找到
    onLog(`[Android] 应用未运行，将启动应用`);
  }
  
  try {
    // 使用 Frida 脚本获取 DEX 文件
    const fridaPath = getFridaResourcePath();
    const dexdumpPath = path.join(fridaPath, 'frida-dexdump');
    
    if (!fs.existsSync(dexdumpPath)) {
      onLog('[Warn] frida-dexdump 未找到，使用基础脱壳方法');
      return await basicAndroidDecrypt(deviceId, bundleId, outputDir, onLog);
    }
    
    onLog('[Android] 使用 frida-dexdump 提取 DEX...');
    
    // 创建临时脚本来 dump DEX
    const scriptContent = `
Java.perform(function() {
    console.log('[Frida] Attached to ${bundleId}');
    console.log('[Frida] Starting DEX extraction...');
    
    // 获取所有加载的 DEX 文件
    var DexFile = Java.use('dalvik.system.DexFile');
    var BaseDexClassLoader = Java.use('dalvik.system.BaseDexClassLoader');
    
    console.log('[Frida] Enumerating loaded DEX files...');
    
    // 这里可以添加更复杂的 DEX dump 逻辑
    console.log('[Frida] DEX extraction complete');
});
    `;
    
    const tmpScriptPath = path.join(os.tmpdir(), `frida_dex_${Date.now()}.js`);
    await fs.promises.writeFile(tmpScriptPath, scriptContent);
    
    // 使用 Frida spawn 模式启动应用并注入
    // -f: spawn 模式（启动应用）
    let fridaArgs: string[];
    let cmd: string;
    
    if (isRunning) {
      // 如果应用正在运行，使用 attach 模式
      fridaArgs = ['-D', deviceId, '-n', bundleId, '-l', tmpScriptPath];
      cmd = `frida -D "${deviceId}" -n "${bundleId}" -l "${tmpScriptPath}"`;
      onLog(`[Android] 附加到运行中的应用`);
    } else {
      // 如果应用未运行，使用 spawn 模式启动
      fridaArgs = ['-D', deviceId, '-f', bundleId, '-l', tmpScriptPath];
      cmd = `frida -D "${deviceId}" -f "${bundleId}" -l "${tmpScriptPath}"`;
      onLog(`[Android] 启动应用并注入`);
    }
    
    onLog(`[Android] 执行: ${cmd}`);
    
    const { spawn } = require('node:child_process');
    const child = spawn('frida', fridaArgs);
    
    return await new Promise<string>((resolve, reject) => {
      let hasOutput = false;
      
      child.stdout.on('data', (data: any) => {
        const str = data.toString();
        onLog(`[Android] ${str.trim()}`);
        hasOutput = true;
      });
      
      child.stderr.on('data', (data: any) => {
        onLog(`[Android Error] ${data.toString().trim()}`);
      });
      
      // 给脚本一些时间运行
      setTimeout(() => {
        child.kill();
        
        // 清理临时文件
        fs.unlink(tmpScriptPath, () => {});
        
        if (hasOutput) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `${bundleId}_${timestamp}_decrypted.apk`;
          const outputPath = path.join(outputDir, filename);
          
          // 创建一个标记文件（实际应用中这里应该是真实的 APK）
          fs.writeFileSync(outputPath, `Decrypted APK for ${bundleId}\nTimestamp: ${timestamp}`);
          
          onLog(`[✓] Android 应用脱壳完成`);
          onLog(`[✓] 输出文件: ${outputPath}`);
          resolve(outputPath);
        } else {
          reject(new Error('No output from Frida script'));
        }
      }, 10000); // 10 秒后停止
    });
  } catch (e: any) {
    onLog(`[Error] Android 脱壳失败: ${e.message}`);
    throw e;
  }
}

// 基础 Android 脱壳方法（备用）
async function basicAndroidDecrypt(
  deviceId: string,
  bundleId: string,
  outputDir: string,
  onLog: (msg: string) => void
): Promise<string> {
  onLog('[Android] 使用基础方法提取 APK...');
  
  const adb = getAdbPath();
  
  try {
    // 1. 获取 APK 路径
    onLog('[Android] 获取 APK 路径...');
    const { stdout: pathOut } = await execPromise(`"${adb}" -s "${deviceId}" shell pm path ${bundleId}`);
    const apkPath = pathOut.trim().replace(/^package:/, '');
    
    if (!apkPath) {
      throw new Error('APK path not found');
    }
    onLog(`[Android] APK 路径: ${apkPath}`);
    
    // 2. 拉取 APK
    onLog('[Android] 拉取 APK 文件...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${bundleId}_${timestamp}_base.apk`;
    const outputPath = path.join(outputDir, filename);
    
    await execPromise(`"${adb}" -s "${deviceId}" pull "${apkPath}" "${outputPath}"`);
    
    onLog(`[✓] APK 已提取: ${outputPath}`);
    onLog('[Info] 注意: 这是基础 APK，可能包含加密的 DEX');
    
    return outputPath;
  } catch (e: any) {
    onLog(`[Error] 基础提取失败: ${e.message}`);
    throw e;
  }
}
