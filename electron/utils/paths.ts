import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * 获取 ADB 可执行文件的路径
 * 优先级：
 * 1. 环境变量 MKTOOLS_ADB_PATH
 * 2. 内置资源目录 (resources/bin/<platform>/adb)
 * 3. 系统 PATH 中的 adb
 * 4. 常见安装路径
 */
export function getAdbPath(): string {
  if (process.env.MKTOOLS_ADB_PATH) {
    return process.env.MKTOOLS_ADB_PATH;
  }

  const platform = process.platform;

  // 0. 优先查找内置的 ADB (resources/bin)
  // 策略1: 尝试标准 Packaged 路径
  let builtInPath = '';
  if (platform === 'win32') {
      builtInPath = path.join(process.resourcesPath, 'bin', 'win', 'adb.exe');
  } else if (platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
      builtInPath = path.join(process.resourcesPath, 'bin', arch, 'adb');
  } else {
      builtInPath = path.join(process.resourcesPath, 'bin', 'linux', 'adb');
  }

  if (fs.existsSync(builtInPath)) {
      return builtInPath;
  }

  // 策略2: 尝试开发环境路径 (CWD)
  if (platform === 'win32') {
      builtInPath = path.join(process.cwd(), 'resources', 'bin', 'win', 'adb.exe');
  } else if (platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
      builtInPath = path.join(process.cwd(), 'resources', 'bin', arch, 'adb');
  } else {
      builtInPath = path.join(process.cwd(), 'resources', 'bin', 'linux', 'adb');
  }

  if (fs.existsSync(builtInPath)) {
      return builtInPath;
  }

  // 策略3: 尝试从 __dirname 推断
  const rootDir = path.resolve(__dirname, '..');
  if (platform === 'win32') {
      builtInPath = path.join(rootDir, 'resources', 'bin', 'win', 'adb.exe');
  } else if (platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
      builtInPath = path.join(rootDir, 'resources', 'bin', arch, 'adb');
  } else {
      builtInPath = path.join(rootDir, 'resources', 'bin', 'linux', 'adb');
  }

  if (fs.existsSync(builtInPath)) {
    return builtInPath;
  } else {
    // Built-in ADB not found, will search in PATH
  }

  // 1. 尝试环境变量中的 adb
  try {
    // 简单检查 adb 是否在 PATH 中
    execSync(platform === 'win32' ? 'where adb' : 'which adb');
    return 'adb';
  } catch (e) {
    //不在 PATH 中，继续查找
  }

  // 2. 查找常见安装路径
  let possiblePaths: string[] = [];

  if (platform === 'win32') {
    possiblePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Android', 'Android Studio', 'bin', 'adb.exe'),
      'C:\\adb\\adb.exe'
    ];
  } else if (platform === 'darwin') {
    possiblePaths = [
      `/Users/${process.env.USER}/Library/Android/sdk/platform-tools/adb`,
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb'
    ];
  } else {
    // Linux
    possiblePaths = [
      `/home/${process.env.USER}/Android/Sdk/platform-tools/adb`,
      '/usr/bin/adb',
      '/usr/local/bin/adb'
    ];
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 默认返回 adb，希望用户已配置 PATH
  return platform === 'win32' ? 'adb.exe' : 'adb';
}

/**
 * 获取 iOS 工具路径
 * 优先查找 libimobiledevice 工具 (resources/bin/<platform>/<toolName>)
 * 如果找不到则回退到系统 PATH
 */
export function getIosToolPath(toolName: string): string {
  const platform = process.platform;
  
  // 0. 优先查找内置工具 (resources/bin)
  // 策略1: 标准 Packaged 路径
  let builtInPath = '';
  if (platform === 'win32') {
      builtInPath = path.join(process.resourcesPath, 'bin', 'win', toolName + '.exe');
  } else if (platform === 'darwin') {
      // 区分架构选择路径
      const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
      builtInPath = path.join(process.resourcesPath, 'bin', arch, toolName);
      
      // 兼容旧路径: 如果新架构目录不存在，尝试回退到旧的 mac 目录
      if (!fs.existsSync(builtInPath)) {
          builtInPath = path.join(process.resourcesPath, 'bin', 'mac', toolName);
      }
  } else {
      builtInPath = path.join(process.resourcesPath, 'bin', 'linux', toolName);
  }

  if (fs.existsSync(builtInPath)) {
      return builtInPath;
  }

  // 策略2: 尝试开发环境路径 (CWD)
  if (platform === 'win32') {
      builtInPath = path.join(process.cwd(), 'resources', 'bin', 'win', toolName + '.exe');
  } else if (platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
      builtInPath = path.join(process.cwd(), 'resources', 'bin', arch, toolName);

      // 兼容旧路径
      if (!fs.existsSync(builtInPath)) {
        builtInPath = path.join(process.cwd(), 'resources', 'bin', 'mac', toolName);
      }
  } else {
      builtInPath = path.join(process.cwd(), 'resources', 'bin', 'linux', toolName);
  }

  if (fs.existsSync(builtInPath)) {
      return builtInPath;
  }

  // 策略3: 尝试从 __dirname 推断
  const rootDir = path.resolve(__dirname, '..');
  if (platform === 'win32') {
      builtInPath = path.join(rootDir, 'resources', 'bin', 'win', toolName + '.exe');
  } else if (platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
      builtInPath = path.join(rootDir, 'resources', 'bin', arch, toolName);
      
      // 兼容旧路径
      if (!fs.existsSync(builtInPath)) {
        builtInPath = path.join(rootDir, 'resources', 'bin', 'mac', toolName);
      }
  } else {
      builtInPath = path.join(rootDir, 'resources', 'bin', 'linux', toolName);
  }

  if (fs.existsSync(builtInPath)) {
    return builtInPath;
  }

  // 1. 尝试系统 PATH
  try {
    execSync(platform === 'win32' ? `where ${toolName}` : `which ${toolName}`);
    return toolName;
  } catch (e) {
    // ignore
  }

  // 默认返回空字符串，表示找不到
  return '';
}

/**
 * 获取 iproxy 工具路径
 * 用于 iOS 设备的端口转发
 */
export function getIproxyPath(): string {
  return getIosToolPath('iproxy');
}

/**
 * 获取 sshpass 工具路径
 * 用于 SSH 自动密码输入
 */
export function getSshpassPath(): string {
  return getIosToolPath('sshpass');
}

/**
 * 获取内置 JAR 工具路径
 */
export function getJarToolPath(jarName: string): string {
  // 1. 优先尝试标准的 packaged 路径
  let builtInPath = path.join(process.resourcesPath, 'bin', 'tools', jarName);
  if (fs.existsSync(builtInPath)) {
    return builtInPath;
  }

  // 2. 如果标准路径找不到，尝试开发环境路径 (兼容 app.isPackaged=true 但资源未打包的情况)
  // 策略1: 尝试从 process.cwd() 查找 (通常是项目根目录)
  builtInPath = path.join(process.cwd(), 'resources', 'bin', 'tools', jarName);
  if (fs.existsSync(builtInPath)) {
    return builtInPath;
  }

  // 策略2: 尝试从 __dirname 推断 (假设在 dist-electron 下)
  const rootDir = path.resolve(__dirname, '..');
  builtInPath = path.join(rootDir, 'resources', 'bin', 'tools', jarName);
  if (fs.existsSync(builtInPath)) {
    return builtInPath;
  }

  // Debug info
  console.error(`[getJarToolPath] JAR not found: ${jarName}`);
  console.error(`  - Search Path (Packaged): ${path.join(process.resourcesPath, 'bin', 'tools', jarName)}`);
  console.error(`  - Search Path (CWD): ${path.join(process.cwd(), 'resources', 'bin', 'tools', jarName)}`);
  console.error(`  - isPackaged: ${app.isPackaged}`);
  console.error(`  - __dirname: ${__dirname}`);
  console.error(`  - cwd: ${process.cwd()}`);

  return '';
}

/**
 * 获取 Android SDK 根目录
 */
export function getAndroidSdkPath(): string {
  // 1. 检查环境变量
  const envPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // 2. 检查常见安装路径
  const platform = process.platform;
  let possiblePaths: string[] = [];

  if (platform === 'win32') {
    possiblePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
      path.join(process.env.PROGRAMFILES || '', 'Android', 'Android Studio', 'sdk'),
      'C:\\Android\\sdk'
    ];
  } else if (platform === 'darwin') {
    possiblePaths = [
      path.join(os.homedir(), 'Library', 'Android', 'sdk'),
      '/usr/local/share/android-sdk',
      '/opt/android-sdk'
    ];
  } else {
    possiblePaths = [
      path.join(os.homedir(), 'Android', 'Sdk'),
      '/usr/lib/android-sdk',
      '/opt/android-sdk'
    ];
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  return '';
}

/**
 * 自动识别最新的 Android Build-Tools 路径
 */
export function getBuildToolsPath(): string {
  const sdkPath = getAndroidSdkPath();
  if (!sdkPath) return '';

  const buildToolsDir = path.join(sdkPath, 'build-tools');
  if (!fs.existsSync(buildToolsDir)) return '';

  try {
    const versions = fs.readdirSync(buildToolsDir)
      .filter(name => fs.statSync(path.join(buildToolsDir, name)).isDirectory())
      .sort((a, b) => {
        // 简单的版本号排序 (例如 30.0.3 vs 31.0.0)
        return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
      });

    if (versions.length > 0) {
      return path.join(buildToolsDir, versions[0]);
    }
  } catch (e) {
    console.error('Failed to list build-tools:', e);
  }

  return '';
}
