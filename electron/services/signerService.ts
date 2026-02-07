import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec, execSync } from 'node:child_process';
import util from 'node:util';
import { getAdbPath, getJarToolPath, getBuildToolsPath } from '../utils/paths';
import { SmaliTemplates } from './smaliTemplates';

const execPromise = util.promisify(exec);
const MAX_BUFFER_SIZE = 1024 * 1024 * 50; // 50MB

export interface SignResult {
  success: boolean;
  message: string;
  outputPath?: string;
}

// 辅助函数：带日志的执行
async function execWithLog(command: string, onLog?: (msg: string) => void) {
  if (onLog) onLog(`Executing: ${command}`);
  const { stdout, stderr } = await execPromise(command, { maxBuffer: MAX_BUFFER_SIZE });
  if (stdout && onLog) onLog(stdout);
  if (stderr && onLog) onLog(`Stderr: ${stderr}`);
  return { stdout, stderr };
}

/**
 * 获取 Keystore 别名列表
 */
export async function getKeystoreAliases(keystorePath: string, storePass: string): Promise<string[]> {
  try {
    const cmd = `keytool -list -v -keystore "${keystorePath}" -storepass "${storePass}"`;
    const { stdout } = await execPromise(cmd);
    const aliases: string[] = [];
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('Alias name:')) {
        aliases.push(line.split('Alias name:')[1].trim());
      } else if (line.includes('别名:')) {
        aliases.push(line.split('别名:')[1].trim());
      }
    }
    return aliases;
  } catch (e: any) {
    console.error('Failed to get keystore aliases', e);
    throw new Error(`无法读取 Keystore: ${e.message}`);
  }
}

/**
 * 分析 APK 信息
 */
export async function analyzeApk(apkPath: string, buildToolsPathOverride?: string): Promise<any> {
  const buildToolsPath = buildToolsPathOverride || getBuildToolsPath();
  const aapt = path.join(buildToolsPath, 'aapt');
  
  try {
    const cmd = `"${aapt}" dump badging "${apkPath}"`;
    const { stdout } = await execPromise(cmd, { maxBuffer: MAX_BUFFER_SIZE });
    
    const packageNameMatch = stdout.match(/package: name='([^']+)'/);
    const versionCodeMatch = stdout.match(/versionCode='([^']+)'/);
    const versionNameMatch = stdout.match(/versionName='([^']+)'/);
    const labelMatch = stdout.match(/application-label:'([^']+)'/);
    
    return {
      packageName: packageNameMatch ? packageNameMatch[1] : '',
      versionCode: versionCodeMatch ? versionCodeMatch[1] : '',
      versionName: versionNameMatch ? versionNameMatch[1] : '',
      label: labelMatch ? labelMatch[1] : ''
    };
  } catch (e) {
    console.error('Failed to analyze APK', e);
    return { packageName: 'Unknown', versionCode: '0', versionName: '0.0', label: 'Unknown' };
  }
}

/**
 * 普通 APK 重签名 (仅签名，不注入)
 */
export async function resignApk(args: {
  apkPath: string,
  keystorePath: string,
  storePass: string,
  keyPass: string,
  alias: string,
  onLog?: (msg: string) => void
}): Promise<SignResult> {
  const { apkPath, keystorePath, storePass, keyPass, alias, onLog } = args;
  
  if (!apkPath || !fs.existsSync(apkPath)) return { success: false, message: 'APK 不存在' };
  
  const outputApk = apkPath.replace('.apk', '_signed.apk');
  const apksigner = getJarToolPath('apksigner.jar');
  const buildToolsPath = getBuildToolsPath();
  const apksignerBat = path.join(buildToolsPath, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');

  try {
    if (onLog) onLog('开始签名...');
    
    let cmd = '';
    if (fs.existsSync(apksignerBat)) {
      cmd = `"${apksignerBat}" sign --ks "${keystorePath}" --ks-pass pass:"${storePass}" --key-pass pass:"${keyPass}" --ks-key-alias "${alias}" --out "${outputApk}" "${apkPath}"`;
    } else if (fs.existsSync(apksigner)) {
      cmd = `java -jar "${apksigner}" sign --ks "${keystorePath}" --ks-pass pass:"${storePass}" --key-pass pass:"${keyPass}" --ks-key-alias "${alias}" --out "${outputApk}" "${apkPath}"`;
    } else {
      if (onLog) onLog('未找到 apksigner，尝试使用 jarsigner...');
      fs.copyFileSync(apkPath, outputApk);
      cmd = `jarsigner -verbose -sigalg SHA1withRSA -digestalg SHA1 -keystore "${keystorePath}" -storepass "${storePass}" -keypass "${keyPass}" "${outputApk}" "${alias}"`;
    }
    
    await execWithLog(cmd, onLog);
    
    // 验证签名
    if (onLog) onLog('验证签名...');
    let verifyCmd = '';
    if (fs.existsSync(apksignerBat)) {
      verifyCmd = `"${apksignerBat}" verify "${outputApk}"`;
    } else if (fs.existsSync(apksigner)) {
      verifyCmd = `java -jar "${apksigner}" verify "${outputApk}"`;
    }
    
    if (verifyCmd) {
      await execWithLog(verifyCmd, onLog);
    }

    return { success: true, message: '签名成功', outputPath: outputApk };
  } catch (e: any) {
    if (onLog) onLog(`签名失败: ${e.message}`);
    return { success: false, message: `签名失败: ${e.message}` };
  }
}

/**
 * 提取 APK 原始签名 (V1 或 V2/V3)
 */
async function getOriginalSignature(apkPath: string, onLog?: (msg: string) => void): Promise<string> {
    // 强制使用 ApkSigReader 获取签名信息
    if (onLog) onLog('正在使用 ApkSigReader 提取签名...');
    return await getCertHexUsingApkSig(apkPath, onLog);
}

async function getCertRsaHex(apkPath: string): Promise<string> {
    try {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-cert-'));
        try {
            // 列出文件
            const { stdout } = await execPromise(`unzip -l "${apkPath}"`);
            const lines = stdout.split('\n');
            let certFile = '';
            for (const line of lines) {
                // unzip output: length date time name
                const parts = line.trim().split(/\s+/);
                const fileName = parts[parts.length - 1];
                if (fileName && fileName.startsWith('META-INF/') && 
                   (fileName.endsWith('.RSA') || fileName.endsWith('.DSA') || fileName.endsWith('.EC'))) {
                    certFile = fileName;
                    break;
                }
            }
            
            if (certFile) {
                const outputFile = path.join(tempDir, 'CERT');
                // 解压签名文件
                await execPromise(`unzip -p "${apkPath}" "${certFile}" > "${outputFile}"`);
                const buffer = fs.readFileSync(outputFile);
                return buffer.toString('hex').toLowerCase(); // 保持与 app_signer 一致 (小写)
            }
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    } catch (e) {
        // ignore
    }
    return '00';
}

async function getCertHexUsingApkSig(apkPath: string, onLog?: (msg: string) => void): Promise<string> {
    const apkSigReader = getJarToolPath('ApkSigReader.jar');
    if (!fs.existsSync(apkSigReader)) {
        if (onLog) onLog('警告: 找不到 ApkSigReader.jar');
        return '00';
    }
    
    try {
        const { stdout } = await execPromise(`java -jar "${apkSigReader}" "${apkPath}"`);
        const output = stdout.trim();
        if (output && /^[0-9a-fA-F]+$/.test(output)) {
            return output.toLowerCase();
        }
    } catch (e) {
        if (onLog) onLog(`ApkSigReader 执行失败: ${e}`);
    }
    return '00';
}

/**
 * 注入并重签名 (核心功能)
 */
export async function injectAndResignApk(args: {
  apkPath: string,
  keystorePath: string,
  storePass: string,
  keyPass: string,
  alias: string,
  onLog?: (msg: string) => void
}): Promise<SignResult> {
  const { apkPath, keystorePath, storePass, keyPass, alias, onLog } = args;
  
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-inject-'));
  const decodeDir = path.join(tempDir, 'decoded');
  const outputApk = apkPath.replace('.apk', '_hooked_signed.apk');
  const apktool = getJarToolPath('apktool.jar');
  
  try {
    // 0. 提取原始签名
    if (onLog) onLog('正在提取原始签名...');
    const originalSignature = await getOriginalSignature(apkPath, onLog);
    if (!originalSignature || originalSignature === '00') {
        if (onLog) onLog('警告: 无法提取原始签名，生成的 APK 可能无法通过签名验证');
    } else {
        if (onLog) onLog(`提取签名成功 (长度: ${originalSignature.length})\nSignature: ${originalSignature}`);
    }

    // 0.5 获取包名 (优先使用 aapt 获取)
    let packageName = '';
    try {
        const info = await analyzeApk(apkPath);
        if (info && info.packageName && info.packageName !== 'Unknown') {
            packageName = info.packageName;
            if (onLog) onLog(`获取包名成功: ${packageName}`);
        }
    } catch (e) {
        if (onLog) onLog(`获取包名失败 (aapt): ${e}`);
    }

    // 1. 反编译
    if (onLog) onLog('正在反编译 APK (apktool)...');
    await execWithLog(`java -jar "${apktool}" d -r -f -o "${decodeDir}" "${apkPath}"`, onLog);

    // 2. 注入 Hook 代码
    if (onLog) onLog('正在注入 Hook 代码...');
    const { manifestModified, binaryManifestPath } = await injectHookCode(decodeDir, originalSignature, packageName, apkPath, onLog);

    // 3. 回编译
    if (onLog) onLog('正在回编译 APK (apktool)...');
    const buildApk = path.join(tempDir, 'dist.apk');
    await execWithLog(`java -jar "${apktool}" b -o "${buildApk}" "${decodeDir}"`, onLog);

    // 4. 合并 Dex (解决 residual dex 问题)
    if (onLog) onLog('合并 Dex 到原始 APK (保留原始资源)...');
    const mergedApk = path.join(tempDir, 'merged.apk');
    await mergeDexIntoOriginalApk(apkPath, buildApk, mergedApk, manifestModified, binaryManifestPath, onLog);

    // 5. 对齐 (zipalign)
    if (onLog) onLog('执行 zipalign 对齐...');
    const buildToolsPath = getBuildToolsPath();
    const zipalign = path.join(buildToolsPath, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign');
    const alignedApk = path.join(tempDir, 'aligned.apk');
    
    if (fs.existsSync(zipalign)) {
      // app_signer uses -p 4
      await execWithLog(`"${zipalign}" -f -p 4 "${mergedApk}" "${alignedApk}"`, onLog);
    } else {
      if (onLog) onLog('警告: 未找到 zipalign，跳过对齐步骤');
      fs.copyFileSync(mergedApk, alignedApk);
    }

    // 6. 签名
    if (onLog) onLog('正在签名...');
    const signResult = await resignApk({
      apkPath: alignedApk,
      keystorePath,
      storePass,
      keyPass,
      alias,
      onLog
    });
    
    if (!signResult.success) {
        throw new Error(signResult.message);
    }
    
    // 移动最终文件
    const signedTemp = alignedApk.replace('.apk', '_signed.apk');
    if (fs.existsSync(signedTemp)) {
        fs.copyFileSync(signedTemp, outputApk);
        return { success: true, message: '注入并签名成功', outputPath: outputApk };
    } else {
        throw new Error('签名后文件未生成');
    }

  } catch (e: any) {
    if (onLog) onLog(`处理失败: ${e.message}`);
    return { success: false, message: `处理失败: ${e.message}` };
  } finally {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

async function injectHookCode(decodeDir: string, signature: string, packageName: string, originalApkPath: string, onLog?: (msg: string) => void): Promise<{ manifestModified: boolean, binaryManifestPath?: string }> {
  // 1. 读取 AndroidManifest.xml 找到 Application 类
  const manifestPath = path.join(decodeDir, 'AndroidManifest.xml');
  
  // Robust Manifest Reading (Handle Binary XML)
  let manifestContent = '';
  let isBinaryManifest = false;
  const buffer = fs.readFileSync(manifestPath);
  
  // Check for Binary XML Magic Header (0x03 0x00)
  if (buffer.length > 4 && buffer[0] === 0x03 && buffer[1] === 0x00) {
      if (onLog) onLog('检测到二进制 Manifest，正在转换为文本格式以支持修改...');
      const axmlPrinter = getJarToolPath('AXMLPrinter2.jar');
      if (fs.existsSync(axmlPrinter)) {
          try {
             const { stdout } = await execPromise(`java -jar "${axmlPrinter}" "${manifestPath}"`);
             manifestContent = stdout;
             // Save converted text back to file to enable modification
             fs.writeFileSync(manifestPath, manifestContent);
             // Now treat it as non-binary
             isBinaryManifest = false;
          } catch (e) {
             if (onLog) onLog(`AXMLPrinter 解码失败: ${e}`);
             // Fallback to original buffer if decoding fails
             isBinaryManifest = true; 
          }
      } else {
          if (onLog) onLog('警告: 未找到 AXMLPrinter2.jar，尝试直接读取...');
          manifestContent = buffer.toString('utf-8');
          isBinaryManifest = true;
      }
  } else {
      manifestContent = buffer.toString('utf-8');
  }
  
  // Fallback if still empty
  if (!manifestContent) {
      manifestContent = buffer.toString('utf-8');
  }

  // 获取包名 (如果未传入或需要校验)
  let pkgName = packageName;
  if (!pkgName) {
      // 改进的正则，支持多行和空白
      const pkgMatch = manifestContent.match(/package\s*=\s*["']([^"']+)["']/);
      pkgName = pkgMatch ? pkgMatch[1] : '';
      if (!pkgName) {
          throw new Error('无法在 Manifest 中找到包名，且未通过 aapt 获取到包名');
      }
  }

  // 匹配 application
  let appClass = extractApplicationName(manifestContent);
  let manifestModified = false;
  let binaryManifestPath: string | undefined = undefined;
  
  // 注入策略：
  // 1. 如果有 Application 类 -> 注入 attachBaseContext
  // 2. 如果无 Application 类 -> 尝试修改 Manifest 注入 MyApplication
  //    优先尝试修改二进制 Manifest (AXMLEditor)，如果失败则尝试修改文本 Manifest (apktool b)
  
  if (appClass) {
    if (onLog) onLog(`目标 Application 类: ${appClass}`);
    
    const fullClassName = normalizeClassName(appClass, pkgName);
    const smaliPath = findSmaliFile(decodeDir, fullClassName);
    
    if (smaliPath) {
        injectCodeToSmali(smaliPath, signature, pkgName, 'attachBaseContext', onLog);
    } else {
       throw new Error(`无法定位 Application 类文件: ${fullClassName}`);
    }
  } else {
    // 无 Application 类，必须注入 MyApplication
    if (onLog) onLog('未找到 Application 类，准备注入 MyApplication...');

    // 尝试修改 Manifest
    let injected = false;
    
    // 方案 A: 使用 ManifestEditor 直接修改二进制 Manifest (最稳健，不依赖 apktool 回编译 Manifest)
    if (onLog) onLog('尝试使用 ManifestEditor 修改二进制 Manifest...');
    const manifestEditor = getJarToolPath('ManifestEditor-2.0.jar');
    
    if (fs.existsSync(manifestEditor)) {
        try {
            // 1. 从原 APK 提取二进制 Manifest
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-edit-'));
            const originalManifestPath = path.join(tempDir, 'AndroidManifest.xml');
            const modifiedManifestPath = path.join(tempDir, 'AndroidManifest_mod.xml');
            
            await execPromise(`unzip -p "${originalApkPath}" AndroidManifest.xml > "${originalManifestPath}"`);
            
            // 2. 使用 ManifestEditor 修改 application name
            // 用法: java -jar ManifestEditor.jar [input] -an [name] -o [output]
            const cmd = `java -jar "${manifestEditor}" "${originalManifestPath}" -an com.demo.repackage.MyApplication -o "${modifiedManifestPath}"`;
            await execWithLog(cmd, onLog);
            
            if (fs.existsSync(modifiedManifestPath)) {
                binaryManifestPath = modifiedManifestPath;
                manifestModified = true;
                injected = true;
                if (onLog) onLog('二进制 Manifest 修改成功 (ManifestEditor)');
            } else {
                 if (onLog) onLog('ManifestEditor 执行完成但未生成输出文件');
            }
        } catch (e: any) {
            if (onLog) onLog(`ManifestEditor 修改失败: ${e.message}，尝试降级方案...`);
        }
    }

    // 方案 B: 如果二进制修改失败，尝试修改文本 Manifest (依赖 apktool 回编译)
    if (!injected) {
        if (!isBinaryManifest) {
            try {
                if (onLog) onLog('尝试修改文本 Manifest...');
                
                let newManifest = manifestContent;
                if (newManifest.includes('<application')) {
                     newManifest = newManifest.replace(/<application/, '<application android:name="com.demo.repackage.MyApplication"');
                     fs.writeFileSync(manifestPath, newManifest);
                     manifestModified = true;
                     injected = true;
                     if (onLog) onLog('文本 Manifest 修改成功');
                } else {
                    if (onLog) onLog('无法在 Manifest 中找到 <application> 标签');
                }
            } catch (e: any) {
                if (onLog) onLog(`修改文本 Manifest 失败: ${e.message}`);
            }
        } else {
             if (onLog) onLog('Manifest 为二进制格式且无法转换，无法进行文本修改');
        }
    }
    
    if (injected) {
        // 创建 MyApplication.smali
        createMyApplication(decodeDir, signature, pkgName, onLog);
        if (onLog) onLog('已生成 MyApplication.smali');
    } else {
         // 最后尝试: 注入 Activity/Provider (现有逻辑，作为最后的兜底)
         // 但用户反馈 Activity 注入无效，且强制要求修改 Manifest，所以这里报错可能更合适
         // 不过为了健壮性，我们还是尝试一下兜底
         if (onLog) onLog('Manifest 修改失败，尝试注入入口 Activity (兜底方案)...');
         
         const launchActivity = findLaunchActivity(manifestContent);
         if (launchActivity) {
             const fullClassName = normalizeClassName(launchActivity, pkgName);
             const smaliPath = findSmaliFile(decodeDir, fullClassName);
             if (smaliPath) {
                 try {
                     injectCodeToSmali(smaliPath, signature, pkgName, 'staticBlock', onLog);
                     if (onLog) onLog('入口 Activity 静态代码块注入成功 (Fallback)');
                     // 这里不设置 manifestModified，因为我们没改 Manifest
                     return { manifestModified: false };
                 } catch (e) {
                      // ignore
                 }
             }
         }
         
         throw new Error('无法修改 Manifest 且无法注入 Application，签名验证可能失效');
    }
  }
  
  // 4. 复制 ProxyHookPMS.smali 和 HookServiceWraper.smali
  // 动态查找下一个可用的 smali_classes 目录，避免主 dex (classes.dex) 溢出 (65k limit)
  let maxIndex = 1;
  const dirs = fs.readdirSync(decodeDir).filter(d => d.startsWith('smali_classes'));
  for (const d of dirs) {
    const match = d.match(/smali_classes(\d+)/);
    if (match) {
      const index = parseInt(match[1], 10);
      if (index > maxIndex) {
        maxIndex = index;
      }
    }
  }
  
  // 使用下一个可用的目录索引 (或者如果 smali 目录已经很大，使用 smali_classes2)
  // 注意：smali 对应 classes.dex, smali_classes2 对应 classes2.dex
  // 如果没有任何 smali_classesX 目录，说明只有 smali，那么下一个应该是 smali_classes2
  let nextSmaliDir = `smali_classes${maxIndex + 1}`;
  if (dirs.length === 0) {
      // 检查 smali 是否存在
      if (fs.existsSync(path.join(decodeDir, 'smali'))) {
          nextSmaliDir = 'smali_classes2';
      } else {
          // 理论上不会发生，除非反编译完全失败
          nextSmaliDir = 'smali'; 
      }
  }

  const targetDir = path.join(decodeDir, nextSmaliDir, 'com', 'verify', 'signature');
  fs.mkdirSync(targetDir, { recursive: true });
  
  fs.writeFileSync(path.join(targetDir, 'ProxyHookPMS.smali'), SmaliTemplates.proxyHookPMS);
  fs.writeFileSync(path.join(targetDir, 'HookServiceWraper.smali'), SmaliTemplates.hookServiceWraper);
  
  if (onLog) onLog(`已写入 Hook 辅助类 (ProxyHookPMS, HookServiceWraper) 到 ${nextSmaliDir}`);
  return { manifestModified, binaryManifestPath };
}

function extractApplicationName(content: string): string | null {
    const appStart = content.indexOf('<application');
    if (appStart === -1) return null;
    
    let scanningArea = content.substring(appStart);
    
    // Stop at the first occurrence of a child tag or closing application tag
    // to prevent matching attributes of children.
    const stopPattern = /<activity|<service|<provider|<receiver|<meta-data|<\/application/i;
    const stopMatch = scanningArea.match(stopPattern);
    
    if (stopMatch && stopMatch.index !== undefined) {
        scanningArea = scanningArea.substring(0, stopMatch.index);
    }
    
    const nameMatch = scanningArea.match(/android:name\s*=\s*["']([^"']+)["']/);
    
    if (nameMatch) {
        const name = nameMatch[1];
        // Exclude Android default classes or references
        if (!name.startsWith('@') && 
            !name.startsWith('android.') && 
            name !== 'true' && 
            name !== 'false') {
            return name;
        }
    }
    
    return null;
}

function normalizeClassName(className: string, packageName: string): string {
    if (className.startsWith('.')) {
        return packageName + className;
    }
    return className;
}

function findContentProvider(manifestContent: string): string | null {
    // 查找第一个 provider
    const providerMatch = manifestContent.match(/<provider[\s\S]*?android:name\s*=\s*["']([^"']+)["']/);
    if (providerMatch) {
        const name = providerMatch[1];
        // 过滤系统 Provider
        if (!name.startsWith('android.') && !name.startsWith('androidx.') && !name.startsWith('com.google.')) {
            return name;
        }
    }
    return null;
}

function findLaunchActivity(manifestContent: string): string | null {
    // 简单解析寻找包含 MAIN 和 LAUNCHER 的 activity
    const parts = manifestContent.split('<activity');
    for (const part of parts) {
        if (part.includes('android.intent.action.MAIN') && part.includes('android.intent.category.LAUNCHER')) {
            const nameMatch = part.match(/android:name\s*=\s*["']([^"']+)["']/);
            if (nameMatch) return nameMatch[1];
        }
    }
    return null;
}

function createMyApplication(decodeDir: string, signature: string, pkgName: string, onLog?: (msg: string) => void) {
    const targetDir = path.join(decodeDir, 'smali', 'com', 'demo', 'repackage');
    fs.mkdirSync(targetDir, { recursive: true });
    
    let content = SmaliTemplates.myApplicationTemplate;
    content = content.replace('{SIGNATURE}', signature);
    content = content.replace('{PACKAGE_NAME}', pkgName);
    
    fs.writeFileSync(path.join(targetDir, 'MyApplication.smali'), content);
}

function findSmaliFile(decodeDir: string, className: string): string | null {
    const classPath = className.replace(/\./g, '/') + '.smali';
    // 搜索所有 smali 目录 (smali, smali_classes2, etc.)
    const dirs = fs.readdirSync(decodeDir).filter(d => d.startsWith('smali'));
    for (const d of dirs) {
        const fullPath = path.join(decodeDir, d, classPath);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }
    return null;
}

function injectCodeToSmali(smaliPath: string, signature: string, pkgName: string, method: 'attachBaseContext' | 'onCreate' | 'providerOnCreate' | 'staticBlock', onLog?: (msg: string) => void) {
    let content = fs.readFileSync(smaliPath, 'utf-8');
    
    // 根据方法选择 Context 参数寄存器
    // attachBaseContext(Context base) -> p1 is Context
    // onCreate(Bundle savedInstanceState) -> p0 is this (Activity/Context)
    // providerOnCreate() -> p0 is this (Provider), need getContext()
    // staticBlock() -> No context, pass null
    const contextReg = method === 'attachBaseContext' ? 'p1' : 'p0';
    
    let hookCall = '';
    
    if (method === 'providerOnCreate') {
        hookCall = `
    # Inject Hook Start (Provider)
    const-string v0, "SIGN_HOOK"
    const-string v1, "Starting Provider hook..."
    invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    invoke-virtual {p0}, Landroid/content/ContentProvider;->getContext()Landroid/content/Context;
    move-result-object v2
    const-string v0, "${signature}"
    const-string v1, "${pkgName}"
    invoke-static {v2, v0, v1}, Lcom/verify/signature/HookServiceWraper;->startHookPMS(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V
    # Inject Hook End
    `;
    } else if (method === 'staticBlock') {
        hookCall = `
    # Inject Hook Start (Static Block)
    
    # 1. Log start
    const-string v0, "SIGN_HOOK"
    const-string v1, "Starting static block hook..."
    invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    :try_start_0
    # 2. Get Application Context via Reflection
    # Class.forName("android.app.ActivityThread")
    const-string v0, "android.app.ActivityThread"
    invoke-static {v0}, Ljava/lang/Class;->forName(Ljava/lang/String;)Ljava/lang/Class;
    move-result-object v0

    # getDeclaredMethod("currentApplication", [])
    const-string v1, "currentApplication"
    const/4 v2, 0x0
    new-array v3, v2, [Ljava/lang/Class;
    invoke-virtual {v0, v1, v3}, Ljava/lang/Class;->getDeclaredMethod(Ljava/lang/String;[Ljava/lang/Class;)Ljava/lang/reflect/Method;
    move-result-object v0

    # invoke(null, []) -> Application Context
    const/4 v1, 0x0
    new-array v2, v2, [Ljava/lang/Object;
    invoke-virtual {v0, v1, v2}, Ljava/lang/reflect/Method;->invoke(Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;
    move-result-object v0
    check-cast v0, Landroid/content/Context;
    
    # 3. Log success
    const-string v1, "SIGN_HOOK"
    const-string v2, "Context retrieved successfully in static block"
    invoke-static {v1, v2}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I
    
    # 4. Call startHookPMS(Context, signature, pkgName)
    const-string v1, "${signature}"
    const-string v2, "${pkgName}"
    invoke-static {v0, v1, v2}, Lcom/verify/signature/HookServiceWraper;->startHookPMS(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V
    
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    goto :goto_0

    :catch_0
    move-exception v0
    
    # Log error
    const-string v1, "SIGN_HOOK"
    const-string v2, "Failed to get Context in static block, fallback to null"
    invoke-static {v1, v2, v0}, Landroid/util/Log;->e(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Throwable;)I
    
    # Fallback: call with null context
    const/4 v0, 0x0
    const-string v1, "${signature}"
    const-string v2, "${pkgName}"
    invoke-static {v0, v1, v2}, Lcom/verify/signature/HookServiceWraper;->startHookPMS(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V

    :goto_0
    # Inject Hook End
    `;
    } else {
        hookCall = `
    # Inject Hook Start
    const-string v0, "SIGN_HOOK"
    const-string v1, "Starting Generic hook (${method})..."
    invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    const-string v0, "${signature}"
    const-string v1, "${pkgName}"
    invoke-static {${contextReg}, v0, v1}, Lcom/verify/signature/HookServiceWraper;->startHookPMS(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V
    # Inject Hook End
    `;
    }

    const methodSig = method === 'attachBaseContext' 
        ? 'attachBaseContext\\s*\\(Landroid\\/content\\/Context;\\)V'
        : (method === 'onCreate' 
            ? 'onCreate\\s*\\(Landroid\\/os\\/Bundle;\\)V' 
            : (method === 'staticBlock' ? '<clinit>\\s*\\(\\)V' : 'onCreate\\s*\\(\\)Z'));

    const methodDefRegex = new RegExp(`(\\.method.*${methodSig})`);
    
    if (methodDefRegex.test(content)) {
        // 在方法开始处注入
        // 匹配方法头直到 .locals
        const regex = new RegExp(`(\\.method.*${methodSig}[\\s\\S]*?\\.locals\\s+\\d+)`);
        const match = content.match(regex);
        
        if (match) {
            let header = match[1];
            // 检查 locals
            const localsMatch = header.match(/\.locals\s+(\d+)/);
            if (localsMatch) {
                const count = parseInt(localsMatch[1]);
                // Provider injection needs v0, v1, v2 (3 regs)
                // Static Block needs v0, v1, v2, v3 (4 regs, +2 for method args = 6 safe bet)
                // Normal injection needs v0, v1 (2 regs)
                const minLocals = method === 'staticBlock' ? 6 : (method === 'providerOnCreate' ? 3 : 2);
                
                if (count < minLocals) {
                    header = header.replace(/\.locals\s+\d+/, `.locals ${minLocals}`);
                }
            }
            
            content = content.replace(regex, `${header}\n${hookCall}`);
            if (onLog) onLog(`已注入 ${method}: ${smaliPath}`);
        } else {
             if (onLog) onLog(`警告: 找到 ${method} 但无法匹配 .locals`);
        }
    } else {
        // 如果方法不存在，则创建
        // 获取父类
        const superMatch = content.match(/\.super\s+(L[^;]+;)/);
        let superClass = superMatch ? superMatch[1] : 'Landroid/app/Activity;';
        if (method === 'attachBaseContext') superClass = 'Landroid/app/Application;';
        if (method === 'providerOnCreate') superClass = 'Landroid/content/ContentProvider;';
        
        let newMethod = '';

        if (method === 'providerOnCreate') {
             newMethod = `
# virtual methods
.method public onCreate()Z
    .locals 3
    ${hookCall}
    invoke-super {p0}, ${superClass}->onCreate()Z
    move-result v0
    return v0
.end method
`;
        } else if (method === 'staticBlock') {
            newMethod = `
# direct methods
.method static constructor <clinit>()V
    .locals 6
    ${hookCall}
    return-void
.end method
`;
        } else {
            const superMethodSig = method === 'attachBaseContext' 
                ? 'attachBaseContext(Landroid/content/Context;)V'
                : 'onCreate(Landroid/os/Bundle;)V';

             newMethod = `
# virtual methods
.method protected ${method === 'attachBaseContext' ? 'attachBaseContext(Landroid/content/Context;)V' : 'onCreate(Landroid/os/Bundle;)V'}
    .locals 2
    
    ${hookCall}

    invoke-super {p0${method === 'attachBaseContext' ? ', p1' : ', p1'}}, ${superClass}->${superMethodSig}
    return-void
.end method
`;
        }
        
        // 追加到文件末尾
        content = content.trimEnd() + "\n\n" + newMethod;
        if (onLog) onLog(`已新增 ${method}: ${smaliPath}`);
    }
    
    fs.writeFileSync(smaliPath, content);
}

async function mergeDexIntoOriginalApk(originalApk: string, newApk: string, outputApk: string, updateManifest: boolean, binaryManifestPath: string | undefined, onLog?: (msg: string) => void) {
    fs.copyFileSync(originalApk, outputApk);
    
    // app_signer 不执行删除操作，直接使用 zip -u 更新
    
    const tempDexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-merge-'));
    try {
        await execWithLog(`unzip -o "${newApk}" classes*.dex -d "${tempDexDir}"`, onLog);
        
        if (updateManifest) {
             if (binaryManifestPath && fs.existsSync(binaryManifestPath)) {
                 if (onLog) onLog('使用外部修改的二进制 Manifest...');
                 fs.copyFileSync(binaryManifestPath, path.join(tempDexDir, 'AndroidManifest.xml'));
             } else {
                 if (onLog) onLog('Manifest 已修改，更新 AndroidManifest.xml (from build)...');
                 await execWithLog(`unzip -o "${newApk}" AndroidManifest.xml -d "${tempDexDir}"`, onLog);
             }
        }
        
        // 使用 zip -u -j 更新
        await execWithLog(`cd "${tempDexDir}" && zip -u -j "${outputApk}" *`, onLog);
    } finally {
        fs.rmSync(tempDexDir, { recursive: true, force: true });
    }
}

/**
 * 获取 macOS 系统中的 iOS 签名证书列表
 */
export async function getIosIdentities(): Promise<string[]> {
  if (process.platform !== 'darwin') {
    return [];
  }
  try {
    const { stdout } = await execPromise('security find-identity -v -p codesigning', { maxBuffer: MAX_BUFFER_SIZE });
    const identities: string[] = [];
    const lines = stdout.split('\n');
    for (const line of lines) {
      const match = line.match(/"([^"]+)"/);
      if (match) {
        identities.push(match[1]);
      }
    }
    return [...new Set(identities)];
  } catch (e) {
    console.error('Failed to get iOS identities', e);
    return [];
  }
}

/**
 * iOS 重签名
 */
export async function resignIpa(args: {
  ipaPath: string,
  mobileProvisionPath: string,
  identity: string,
  onLog?: (msg: string) => void
}): Promise<SignResult> {
  const { ipaPath, mobileProvisionPath, identity, onLog } = args;

  if (!ipaPath) return { success: false, message: 'IPA 路径不能为空' };
  if (!fs.existsSync(ipaPath)) return { success: false, message: `IPA 文件不存在: ${ipaPath}` };
  if (!mobileProvisionPath) return { success: false, message: 'MobileProvision 路径不能为空' };
  if (!identity) return { success: false, message: '签名证书不能为空' };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipa-resign-'));
  const outputIpa = ipaPath.replace('.ipa', '_signed.ipa');

  try {
    if (onLog) onLog('正在解压 IPA...');
    await execWithLog(`unzip -q -o "${ipaPath}" -d "${tempDir}"`, onLog);

    const payloadDir = path.join(tempDir, 'Payload');
    if (!fs.existsSync(payloadDir)) {
      throw new Error('无效的 IPA: 找不到 Payload 目录');
    }

    const appDirName = fs.readdirSync(payloadDir).find(f => f.endsWith('.app'));
    if (!appDirName) {
      throw new Error('无效的 IPA: Payload 中找不到 .app 目录');
    }
    const appDir = path.join(payloadDir, appDirName);

    if (onLog) onLog('替换 Provisioning Profile...');
    fs.copyFileSync(mobileProvisionPath, path.join(appDir, 'embedded.mobileprovision'));

    if (onLog) onLog(`执行 codesign (${identity})...`);
    await execWithLog(`codesign -f -s "${identity}" "${appDir}"`, onLog);

    if (onLog) onLog('重新打包 IPA...');
    await execWithLog(`cd "${tempDir}" && zip -qr "${outputIpa}" Payload`, onLog);
    
    return { success: true, message: '重签名成功', outputPath: outputIpa };

  } catch (e: any) {
    if (onLog) onLog(`重签名失败: ${e.message}`);
    return { success: false, message: `重签名失败: ${e.message}` };
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * 分析 Android APK 签名信息
 */
export async function analyzeApkSignature(apkPath: string, onLog?: (msg: string) => void, isResigned: boolean = false): Promise<void> {
  try {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const fileName = path.basename(apkPath);
    
    const prefix = isResigned ? '重签名文件:' : '已加载文件:';
    if (onLog) onLog(`[${timestamp}] ${prefix} ${fileName}`);
    
    // 使用 apksigner 验证签名
    const buildToolsPath = getBuildToolsPath();
    const apksigner = path.join(buildToolsPath, 'apksigner');
    
    if (!fs.existsSync(apksigner)) {
      if (onLog) onLog('[Error] apksigner 工具未找到');
      return;
    }
    
    try {
      const { stdout } = await execPromise(`"${apksigner}" verify --print-certs --verbose "${apkPath}"`);
      
      const timestamp2 = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      if (onLog) onLog(`[${timestamp2}] ✅ 签名验证成功`);
      
      // 解析签名版本 - 更精确的匹配
      // apksigner 输出示例：
      // "Verified using v1 scheme (JAR signing): true"
      // "Verified using v2 scheme (APK Signature Scheme v2): true"
      // "Verified using v3 scheme (APK Signature Scheme v3): false"
      
      let hasV1 = false;
      let hasV2 = false;
      let hasV3 = false;
      
      // 方法1: 检查 "Verified using vX scheme" 后面是否有 "true"
      const v1Match = stdout.match(/Verified using v1 scheme[^:]*:\s*(true|false)/i);
      const v2Match = stdout.match(/Verified using v2 scheme[^:]*:\s*(true|false)/i);
      const v3Match = stdout.match(/Verified using v3 scheme[^:]*:\s*(true|false)/i);
      
      if (v1Match) {
        hasV1 = v1Match[1].toLowerCase() === 'true';
      } else {
        // 方法2: 如果没有明确的 true/false，检查是否包含 "Verified using v1 scheme"
        hasV1 = stdout.includes('Verified using v1 scheme') && !stdout.includes('Verified using v1 scheme: false');
      }
      
      if (v2Match) {
        hasV2 = v2Match[1].toLowerCase() === 'true';
      } else {
        hasV2 = stdout.includes('Verified using v2 scheme') && !stdout.includes('Verified using v2 scheme: false');
      }
      
      if (v3Match) {
        hasV3 = v3Match[1].toLowerCase() === 'true';
      } else {
        hasV3 = stdout.includes('Verified using v3 scheme') && !stdout.includes('Verified using v3 scheme: false');
      }
      
      // 调试：输出原始信息（可选）
      // if (onLog) {
      //   onLog('[Debug] apksigner output:');
      //   onLog(stdout.substring(0, 500));
      // }
      
      if (onLog) {
        onLog('');
        onLog('── 签名版本 ───────────');
        onLog(`V1: ${hasV1 ? '✅' : '❌'}  V2: ${hasV2 ? '✅' : '❌'}  V3: ${hasV3 ? '✅' : '❌'}`);
        onLog('______________________________');
      }
      
      // 提取证书信息
      const certMatch = stdout.match(/Signer #\d+ certificate DN: (.+)/);
      const md5Match = stdout.match(/Signer #\d+ certificate MD5 digest: (.+)/);
      const sha1Match = stdout.match(/Signer #\d+ certificate SHA-1 digest: (.+)/);
      const sha256Match = stdout.match(/Signer #\d+ certificate SHA-256 digest: (.+)/);
      
      if (certMatch && onLog) {
        const dn = certMatch[1].trim();
        onLog(`主题: ${dn}`);
      }
      
      if (md5Match && onLog) {
        const md5 = md5Match[1].trim().replace(/:/g, ' ').toUpperCase();
        onLog(`MD5 签名:     ${md5}`);
      }
      
      if (sha1Match && onLog) {
        const sha1 = sha1Match[1].trim().replace(/:/g, ' ').toUpperCase();
        onLog(`SHA-1 签名:   ${sha1}`);
      }
      
      if (sha256Match && onLog) {
        const sha256 = sha256Match[1].trim().replace(/:/g, ' ').toUpperCase();
        onLog(`SHA-256 签名: ${sha256}`);
      }
      
    } catch (e: any) {
      const timestamp2 = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      if (onLog) onLog(`[${timestamp2}] ❌ 签名验证失败: ${e.message}`);
    }
    
  } catch (e: any) {
    if (onLog) onLog(`[Error] 分析失败: ${e.message}`);
  }
}

/**
 * 分析 iOS IPA 签名信息（embedded.mobileprovision）
 */
export async function analyzeIpaSignature(ipaPath: string, onLog?: (msg: string) => void, isResigned: boolean = false): Promise<void> {
  const tempDir = path.join(os.tmpdir(), `ipa_analyze_${Date.now()}`);
  
  try {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const fileName = path.basename(ipaPath);
    
    const prefix = isResigned ? '重签名文件:' : '已加载文件:';
    if (onLog) onLog(`[${timestamp}] ${prefix} ${fileName}`);
    
    // 创建临时目录
    fs.mkdirSync(tempDir, { recursive: true });
    
    // 解压 IPA
    await execPromise(`unzip -q "${ipaPath}" -d "${tempDir}"`);
    
    // 查找 .app 目录
    const payloadDir = path.join(tempDir, 'Payload');
    if (!fs.existsSync(payloadDir)) {
      if (onLog) onLog('[Error] 无效的 IPA 文件');
      return;
    }
    
    const appDirs = fs.readdirSync(payloadDir).filter(f => f.endsWith('.app'));
    if (appDirs.length === 0) {
      if (onLog) onLog('[Error] 未找到 .app 目录');
      return;
    }
    
    const appDir = path.join(payloadDir, appDirs[0]);
    const provisionPath = path.join(appDir, 'embedded.mobileprovision');
    
    if (!fs.existsSync(provisionPath)) {
      const timestamp2 = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      if (onLog) {
        onLog(`[${timestamp2}] 未找到 embedded.mobileprovision 描述文件`);
        onLog('______________________________');
      }
      return;
    }
    
    // 提取 mobileprovision 的 XML 内容
    const provisionData = fs.readFileSync(provisionPath);
    const provisionStr = provisionData.toString('utf-8');
    
    // 查找 XML 部分（在 <?xml 和 </plist> 之间）
    const xmlStart = provisionStr.indexOf('<?xml');
    const xmlEnd = provisionStr.indexOf('</plist>');
    
    if (xmlStart === -1 || xmlEnd === -1) {
      if (onLog) onLog('[Error] 无法解析 mobileprovision 文件');
      return;
    }
    
    const xmlContent = provisionStr.substring(xmlStart, xmlEnd + 8); // +8 for '</plist>'
    
    const timestamp2 = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    if (onLog) {
      onLog(`[${timestamp2}] 【iOS 描述文件信息】`);
      onLog(xmlContent);
    }
    
  } catch (e: any) {
    if (onLog) onLog(`[Error] 分析失败: ${e.message}`);
  } finally {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
