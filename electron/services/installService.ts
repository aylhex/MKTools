import { exec } from 'node:child_process';
import util from 'node:util';
import { getAdbPath, getIosToolPath } from '../utils/paths';

const execPromise = util.promisify(exec);

/**
 * 从设备路径直接安装 APK（不下载到宿主机）
 */
export async function installApkFromDevice(deviceId: string, devicePath: string): Promise<void> {
  const adb = getAdbPath();
  
  try {
    console.log(`[Install] Installing APK from device path: ${devicePath}`);
    const { stdout, stderr } = await execPromise(`"${adb}" -s "${deviceId}" shell pm install -r "${devicePath}"`);
    
    console.log(`[Install] stdout: ${stdout}`);
    if (stderr) console.log(`[Install] stderr: ${stderr}`);
    
    // 检查是否安装成功
    if (stdout.includes('Success') || stdout.includes('success')) {
      console.log('[Install] APK installed successfully from device');
      return;
    }
    
    // 检查错误信息
    if (stdout.includes('INSTALL_FAILED') || stderr.includes('INSTALL_FAILED') || stdout.includes('Failure')) {
      const errorMatch = stdout.match(/INSTALL_FAILED_[A-Z_]+/) || stderr.match(/INSTALL_FAILED_[A-Z_]+/);
      const errorCode = errorMatch ? errorMatch[0] : 'UNKNOWN';
      throw new Error(`安装失败: ${errorCode}`);
    }
    
    throw new Error('安装失败: 未知错误');
  } catch (err: any) {
    console.error('[Install] Error:', err);
    throw new Error(`从设备安装 APK 失败: ${err.message}`);
  }
}

/**
 * 从本地文件安装 APK 到 Android 设备
 */
export async function installApk(deviceId: string, apkPath: string): Promise<void> {
  const adb = getAdbPath();
  
  try {
    console.log(`[Install] Installing APK: ${apkPath} to device: ${deviceId}`);
    const { stdout, stderr } = await execPromise(`"${adb}" -s "${deviceId}" install -r "${apkPath}"`);
    
    console.log(`[Install] stdout: ${stdout}`);
    if (stderr) console.log(`[Install] stderr: ${stderr}`);
    
    // 检查是否安装成功
    if (stdout.includes('Success') || stdout.includes('success')) {
      console.log('[Install] APK installed successfully');
      return;
    }
    
    // 检查错误信息
    if (stdout.includes('INSTALL_FAILED') || stderr.includes('INSTALL_FAILED')) {
      const errorMatch = stdout.match(/INSTALL_FAILED_[A-Z_]+/) || stderr.match(/INSTALL_FAILED_[A-Z_]+/);
      const errorCode = errorMatch ? errorMatch[0] : 'UNKNOWN';
      throw new Error(`安装失败: ${errorCode}`);
    }
    
    throw new Error('安装失败: 未知错误');
  } catch (err: any) {
    console.error('[Install] Error:', err);
    throw new Error(`安装 APK 失败: ${err.message}`);
  }
}

/**
 * 从本地文件安装 IPA 到 iOS 设备
 */
export async function installIpa(deviceId: string, ipaPath: string): Promise<void> {
  const installer = getIosToolPath('ideviceinstaller');
  
  if (!installer) {
    throw new Error('未找到 ideviceinstaller 工具，无法安装 IPA');
  }
  
  try {
    console.log(`[Install] Installing IPA: ${ipaPath} to device: ${deviceId}`);
    // 正确的命令格式：ideviceinstaller -u UDID install PATH
    const { stdout, stderr } = await execPromise(`"${installer}" -u "${deviceId}" install "${ipaPath}"`, {
      timeout: 120000 // 2分钟超时
    });
    
    console.log(`[Install] stdout: ${stdout}`);
    if (stderr) console.log(`[Install] stderr: ${stderr}`);
    
    // 检查是否安装成功
    if (stdout.includes('Complete') || stdout.includes('complete') || stdout.includes('Install: Complete')) {
      console.log('[Install] IPA installed successfully');
      return;
    }
    
    // 检查错误信息
    if (stderr && stderr.includes('ERROR')) {
      throw new Error(`安装失败: ${stderr}`);
    }
    
    // 如果没有明确的成功或失败信息，假设成功
    console.log('[Install] IPA installation completed');
  } catch (err: any) {
    console.error('[Install] Error:', err);
    
    // 超时错误
    if (err.killed && err.signal === 'SIGTERM') {
      throw new Error('安装超时，请检查设备连接');
    }
    
    throw new Error(`安装 IPA 失败: ${err.message}`);
  }
}

/**
 * 安装应用（自动识别类型）
 */
export async function installApp(deviceId: string, platform: 'android' | 'ios', filePath: string, fileType: 'apk' | 'ipa'): Promise<void> {
  if (platform === 'android' && fileType === 'apk') {
    await installApk(deviceId, filePath);
  } else if (platform === 'ios' && fileType === 'ipa') {
    await installIpa(deviceId, filePath);
  } else {
    throw new Error(`不支持的安装类型: ${platform} - ${fileType}`);
  }
}

/**
 * 从设备路径直接安装应用（不下载到宿主机）
 */
export async function installAppFromDevice(deviceId: string, platform: 'android' | 'ios', devicePath: string, fileType: 'apk' | 'ipa'): Promise<void> {
  if (platform === 'android' && fileType === 'apk') {
    await installApkFromDevice(deviceId, devicePath);
  } else if (platform === 'ios' && fileType === 'ipa') {
    // iOS 不支持从设备路径直接安装，需要先下载
    throw new Error('iOS 不支持从设备路径直接安装，请选择"浏览宿主机"方式安装');
  } else {
    throw new Error(`不支持的安装类型: ${platform} - ${fileType}`);
  }
}
