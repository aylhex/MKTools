import { exec } from 'node:child_process';
import util from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { dialog } from 'electron';
import { getAdbPath, getIosToolPath } from '../utils/paths';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import * as iosSshService from './iosSshService';

const execPromise = util.promisify(exec);

// 存储设备的越狱状态
const jailbreakCache = new Map<string, boolean>();

// ============ iOS File Service Functions (inlined) ============
// 检测设备是否越狱
async function isDeviceJailbroken(deviceId: string): Promise<boolean> {
  // 检查缓存
  if (jailbreakCache.has(deviceId)) {
    const cached = jailbreakCache.get(deviceId)!;
    console.log(`[Jailbreak] Using cached result for ${deviceId}: ${cached}`);
    return cached;
  }
  
  console.log(`[Jailbreak] Checking jailbreak status for device: ${deviceId}`);
  
  // 检测越狱
  const isJailbroken = await iosSshService.checkJailbreak(deviceId);
  console.log(`[Jailbreak] Device ${deviceId} jailbreak status: ${isJailbroken}`);
  
  jailbreakCache.set(deviceId, isJailbroken);
  
  return isJailbroken;
}

// 导出给 IPC 使用
export async function checkJailbreak(deviceId: string): Promise<boolean> {
  console.log(`[Jailbreak IPC] Checking jailbreak for device: ${deviceId}`);
  const result = await isDeviceJailbroken(deviceId);
  console.log(`[Jailbreak IPC] Result: ${result}`);
  return result;
}

// 获取 AFC 服务
// 对于越狱设备：使用 AFC 服务访问整个文件系统（bundleId 为空）
// 对于非越狱设备：使用 HouseArrest 服务访问应用容器（需要 bundleId）
async function getAfcService(deviceId: string, bundleId?: string) {
  const { services } = require('appium-ios-device');
  
  // 如果没有 bundleId，尝试使用 AFC 服务（越狱设备）
  if (!bundleId) {
    try {
      // AFC 服务用于访问越狱设备的整个文件系统
      const afcService = await services.startAfcService(deviceId);
      return afcService;
    } catch (err: any) {
      throw new Error(`无法连接到 AFC 服务（需要越狱设备并安装 Apple File Conduit 2）: ${err.message}`);
    }
  }
  
  // 使用 HouseArrest 服务访问应用容器（非越狱设备）
  const houseArrestService = await services.startHouseArrestService(deviceId);
  const afcService = await houseArrestService.vendContainer(bundleId);
  return afcService;
}

// 使用 AFC 协议或 SSH 列出目录
async function listIosDirectory(deviceId: string, bundleId: string | undefined, path: string): Promise<FileEntry[]> {
  // 如果没有 bundleId，检查是否越狱，使用 SSH
  if (!bundleId) {
    const isJailbroken = await isDeviceJailbroken(deviceId);
    if (isJailbroken) {
      // 越狱设备：使用 SSH 访问完整文件系统
      return await iosSshService.listSshDirectory(deviceId, path);
    }
  }
  
  // 非越狱设备或有 bundleId：使用 AFC
  try {
    const afcService = await getAfcService(deviceId, bundleId);
    
    // AFC 路径处理
    let afcPath: string;
    if (!bundleId) {
      // 越狱设备：直接使用绝对路径，但去掉前导斜杠
      afcPath = path === '/' ? '' : path.replace(/^\//, '');
    } else {
      // 应用容器：根目录用 '.'
      afcPath = path === '/' ? '.' : path.replace(/^\//, '');
    }
    
    const entries = await afcService.listDirectory(afcPath || '.');
    
    const result: FileEntry[] = [];
    for (const entry of entries) {
      // 跳过 . 和 ..
      if (entry === '.' || entry === '..') continue;
      
      const fullPath = (!afcPath || afcPath === '.') ? entry : `${afcPath}/${entry}`;
      try {
        const stat = await afcService.getFileInfo(fullPath);
        
        // 判断文件类型
        const fileType = stat.st_ifmt;
        let isDir = fileType === 'S_IFDIR';
        const isSymlink = fileType === 'S_IFLNK';
        
        // 如果 st_ifmt 未定义，尝试列出该路径来判断是否为目录
        if (stat.st_ifmt === undefined || stat.st_ifmt === null) {
          try {
            await afcService.listDirectory(fullPath);
            isDir = true;
          } catch {
            isDir = false;
          }
        }
        
        const fileEntry: FileEntry = {
          name: entry,
          isDir: isDir,
          size: parseInt(stat.st_size || '0', 10),
          mtime: stat.st_mtime ? new Date(parseInt(stat.st_mtime, 10) * 1000).toISOString() : undefined
        };
        
        // 如果是符号链接，尝试解析目标
        if (isSymlink) {
          // AFC 协议中，符号链接的名称可能包含 -> 目标路径
          // 但通常需要通过 readlink 或其他方式获取
          // 这里我们标记为符号链接，但 AFC 可能不提供目标路径
          // 尝试读取符号链接目标（如果 AFC 支持）
          try {
            // 尝试列出该路径，如果成功说明目标是目录
            await afcService.listDirectory(fullPath);
            fileEntry.isDir = true;
            fileEntry.linkTargetIsDir = true;
          } catch {
            // 目标可能是文件或不存在
            fileEntry.linkTargetIsDir = false;
          }
          
          // 注意：AFC 协议可能不提供符号链接的目标路径
          // 如果需要完整的符号链接信息，建议使用 SSH（越狱设备）
          fileEntry.linkTarget = '(symlink)';
        }
        
        result.push(fileEntry);
      } catch (err) {
        // 如果获取文件信息失败，尝试判断是否为目录
        let isDir = false;
        try {
          await afcService.listDirectory(fullPath);
          isDir = true;
        } catch {
          isDir = false;
        }
        
        result.push({
          name: entry,
          isDir: isDir,
          size: 0
        });
      }
    }
    
    afcService.close();
    return result;
  } catch (err: any) {
    throw new Error(`无法访问 iOS 目录: ${err.message}`);
  }
}

// 下载文件
async function downloadIosFile(deviceId: string, bundleId: string | undefined, remotePath: string, localPath: string): Promise<void> {
  // 如果没有 bundleId，检查是否越狱，使用 SSH
  if (!bundleId) {
    const isJailbroken = await isDeviceJailbroken(deviceId);
    if (isJailbroken) {
      // 越狱设备：使用 SSH 下载
      await iosSshService.downloadSshFile(deviceId, remotePath, localPath);
      return;
    }
  }
  
  // 非越狱设备或有 bundleId：使用 AFC
  let afcService: any = null;
  try {
    afcService = await getAfcService(deviceId, bundleId);
    const afcPath = remotePath.replace(/^\//, '');
    
    // 创建读取流，传递 options 参数
    const readStream = await afcService.createReadStream(afcPath, { autoDestroy: true });
    const chunks: Buffer[] = [];
    
    await new Promise<void>((resolve, reject) => {
      readStream.on('data', (chunk: any) => {
        chunks.push(Buffer.from(chunk));
      });
      
      readStream.on('end', () => {
        resolve();
      });
      
      readStream.on('error', (err: any) => {
        reject(err);
      });
    });
    
    // 写入文件
    const buffer = Buffer.concat(chunks);
    await fsp.writeFile(localPath, buffer);
    
    if (afcService && typeof afcService.close === 'function') {
      afcService.close();
    }
  } catch (err: any) {
    if (afcService && typeof afcService.close === 'function') {
      try {
        afcService.close();
      } catch (e) {}
    }
    throw new Error(`无法下载文件: ${err.message}`);
  }
}

// 上传文件
async function uploadIosFile(deviceId: string, bundleId: string | undefined, localPath: string, remotePath: string): Promise<void> {
  // 如果没有 bundleId，检查是否越狱，使用 SSH
  if (!bundleId) {
    const isJailbroken = await isDeviceJailbroken(deviceId);
    if (isJailbroken) {
      // 越狱设备：使用 SSH 上传
      await iosSshService.uploadSshFile(deviceId, localPath, remotePath);
      return;
    }
  }
  
  // 非越狱设备或有 bundleId：使用 AFC
  let afcService: any = null;
  try {
    afcService = await getAfcService(deviceId, bundleId);
    const afcPath = remotePath.replace(/^\//, '');
    
    // 读取本地文件
    const buffer = await fsp.readFile(localPath);
    
    // 创建写入流，传递 options 参数
    const writeStream = await afcService.createWriteStream(afcPath, { autoDestroy: true });
    
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => {
        resolve();
      });
      
      writeStream.on('error', (err: any) => {
        reject(err);
      });
      
      // 写入数据
      writeStream.write(buffer);
      writeStream.end();
    });
    
    if (afcService && typeof afcService.close === 'function') {
      afcService.close();
    }
  } catch (err: any) {
    if (afcService && typeof afcService.close === 'function') {
      try {
        afcService.close();
      } catch (e) {}
    }
    throw new Error(`无法上传文件: ${err.message}`);
  }
}

// 删除文件或目录
async function deleteIosFile(deviceId: string, bundleId: string | undefined, remotePath: string): Promise<void> {
  // 如果没有 bundleId，检查是否越狱，使用 SSH
  if (!bundleId) {
    const isJailbroken = await isDeviceJailbroken(deviceId);
    if (isJailbroken) {
      // 越狱设备：使用 SSH 删除
      await iosSshService.deleteSshFile(deviceId, remotePath);
      return;
    }
  }
  
  // 非越狱设备或有 bundleId：使用 AFC
  try {
    const afcService = await getAfcService(deviceId, bundleId);
    const afcPath = remotePath.replace(/^\//, '');
    
    // AFC 服务使用 deleteDirectory 来删除文件和目录
    // 这个方法对文件和目录都有效
    await afcService.deleteDirectory(afcPath);
    
    afcService.close();
  } catch (err: any) {
    throw new Error(`无法删除: ${err.message}`);
  }
}

// 创建目录
async function createIosDirectory(deviceId: string, bundleId: string | undefined, remotePath: string): Promise<void> {
  // 如果没有 bundleId，检查是否越狱，使用 SSH
  if (!bundleId) {
    const isJailbroken = await isDeviceJailbroken(deviceId);
    if (isJailbroken) {
      // 越狱设备：使用 SSH 创建目录
      await iosSshService.createSshDirectory(deviceId, remotePath);
      return;
    }
  }
  
  // 非越狱设备或有 bundleId：使用 AFC
  try {
    const afcService = await getAfcService(deviceId, bundleId);
    const afcPath = remotePath.replace(/^\//, '');
    
    await afcService.createDirectory(afcPath);
    
    afcService.close();
  } catch (err: any) {
    throw new Error(`无法创建目录: ${err.message}`);
  }
}

// 重命名文件
async function renameIosFile(deviceId: string, bundleId: string | undefined, oldPath: string, newPath: string): Promise<void> {
  // 如果没有 bundleId，检查是否越狱，使用 SSH
  if (!bundleId) {
    const isJailbroken = await isDeviceJailbroken(deviceId);
    if (isJailbroken) {
      // 越狱设备：使用 SSH 重命名
      await iosSshService.renameSshFile(deviceId, oldPath, newPath);
      return;
    }
  }
  
  // 非越狱设备或有 bundleId：使用 AFC
  try {
    const afcService = await getAfcService(deviceId, bundleId);
    const afcOldPath = oldPath.replace(/^\//, '');
    const afcNewPath = newPath.replace(/^\//, '');
    
    await afcService.rename(afcOldPath, afcNewPath);
    
    afcService.close();
  } catch (err: any) {
    throw new Error(`无法重命名文件: ${err.message}`);
  }
}
// ============ End iOS File Service Functions ============

interface ListArgs {
  deviceId: string;
  platform: 'android' | 'ios';
  path: string;
  bundleId?: string;
}

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime?: string;
  permissions?: string;
  linkTarget?: string;
  linkTargetIsDir?: boolean;
  resolvedPath?: string;
}

function parseLsLine(line: string): FileEntry | null {
  const raw = line.trim();
  if (!raw || raw.startsWith('total')) return null;
  const parts = raw.split(/\s+/);
  if (parts.length < 4) return null;
  const perms = parts[0] || '';
  const isDir = perms.startsWith('d');
  let dateIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[i]) && i + 1 < parts.length && /^\d{2}:\d{2}$/.test(parts[i + 1])) {
      dateIdx = i;
      break;
    }
  }
  let mtime = '';
  let size = 0;
  let name = '';
  if (dateIdx !== -1) {
    mtime = `${parts[dateIdx]} ${parts[dateIdx + 1]}`;
    const sizeToken = parts[dateIdx - 1];
    size = parseInt(sizeToken, 10);
    name = parts.slice(dateIdx + 2).join(' ');
  } else {
    name = parts.slice(3).join(' ');
    const s = parts.find(p => /^\d+$/.test(p));
    size = s ? parseInt(s, 10) : 0;
  }
  
  // 只过滤掉 . 当前目录，保留 .. 父目录
  if (name === '.') return null;
  
  let linkTarget: string | undefined = undefined;
  if (name.includes('->')) {
    const segs = name.split('->');
    name = segs[0].trim();
    linkTarget = segs[1]?.trim();
  }
  return {
    name,
    isDir,
    size: isNaN(size) ? 0 : size,
    mtime,
    permissions: perms,
    linkTarget
  };
}

export async function listDirectory(args: ListArgs, skipSymlinkResolution: boolean = false): Promise<FileEntry[]> {
  const { deviceId, platform, path: dir, bundleId } = args;
  
  if (platform === 'ios') {
    // iOS: 使用 AFC 协议直接访问
    // 如果没有 bundleId，使用 AFC2 服务访问整个文件系统（越狱设备）
    // 如果有 bundleId，使用 HouseArrest 服务访问应用容器
    return await listIosDirectory(deviceId, bundleId, dir);
  }
  
  if (platform === 'android') {
    const adb = getAdbPath();
    
    // 首先检查目标路径是否是符号链接，如果是则解析到最终路径
    let actualDir = dir;
    try {
      const { stdout: resolvedOut } = await execPromise(`"${adb}" -s "${deviceId}" shell "readlink -f '${dir}' 2>/dev/null"`);
      const resolved = resolvedOut.trim();
      if (resolved && resolved.startsWith('/') && resolved !== dir) {
        actualDir = resolved;
      }
    } catch {
      // readlink -f 不可用或路径不是符号链接，使用原路径
    }
    
    const { stdout } = await execPromise(`"${adb}" -s "${deviceId}" shell ls -la "${actualDir}"`);
    const lines = stdout.split('\n');
    const out: FileEntry[] = [];
    
    // 如果跳过符号链接解析，直接返回
    if (skipSymlinkResolution) {
      for (const l of lines) {
        const e = parseLsLine(l);
        if (e) {
          out.push(e);
        }
      }
      return out;
    }
    
    // 收集所有需要解析的符号链接
    const symlinksToResolve: { entry: FileEntry; targetPath: string; index: number }[] = [];
    
    for (const l of lines) {
      const e = parseLsLine(l);
      if (e) {
        const index = out.length;
        out.push(e);
        
        // 检查符号链接的目标类型
        if (e.linkTarget) {
          // 解析目标路径（相对路径转绝对路径）
          let targetPath = e.linkTarget;
          if (!targetPath.startsWith('/')) {
            targetPath = path.posix.resolve(actualDir, targetPath);
          }
          symlinksToResolve.push({ entry: e, targetPath, index });
        }
      }
    }
    
    // 批量解析所有符号链接（分批处理以提高性能）
    if (symlinksToResolve.length > 0) {
      // 如果符号链接太多，分批处理
      const batchSize = 50;
      const batches = [];
      for (let i = 0; i < symlinksToResolve.length; i += batchSize) {
        batches.push(symlinksToResolve.slice(i, i + batchSize));
      }
      
      // 并行处理所有批次
      await Promise.all(batches.map(async (batch, batchIndex) => {
        // 构建批量检查脚本
        const commands = batch.map(({ targetPath }, idx) => {
          const globalIdx = batchIndex * batchSize + idx;
          // 使用双引号并转义特殊字符
          const escapedPath = targetPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
          return `resolved=$(readlink -f "${escapedPath}" 2>/dev/null || echo "${escapedPath}"); if [ -d "$resolved" ]; then echo "${globalIdx}|$resolved|dir"; else echo "${globalIdx}|$resolved|file"; fi`;
        }).join('; ');
        
        try {
          const { stdout: batchResult } = await execPromise(`"${adb}" -s "${deviceId}" shell '${commands}'`);
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
          // 批量解析失败，对这个批次使用并行单个解析
          const resolvePromises = batch.map(async ({ entry, targetPath }) => {
            try {
              const { stdout: result } = await execPromise(
                `"${adb}" -s "${deviceId}" shell "resolved=$(readlink -f '${targetPath}' 2>/dev/null || echo '${targetPath}'); echo \\"$resolved\\"; [ -d \\"$resolved\\" ] && echo 'dir' || echo 'file'"`
              );
              const lines = result.trim().split('\n');
              const resolvedPath = lines[0]?.trim();
              const isDir = lines[1]?.trim() === 'dir';
              
              if (resolvedPath && resolvedPath.startsWith('/')) {
                entry.resolvedPath = resolvedPath;
                entry.linkTargetIsDir = isDir;
                if (isDir) {
                  entry.isDir = true;
                }
              }
            } catch {
              // 解析失败，保持原样
            }
          });
          
          await Promise.all(resolvePromises);
        }
      }));
    }
    
    return out;
  }
  
  throw new Error('不支持的平台');
}

export async function downloadFile(args: { deviceId: string; platform: 'android' | 'ios'; remotePath: string, bundleId?: string }, onProgress?: (percent: number) => void): Promise<string | null> {
  const { deviceId, platform, remotePath, bundleId } = args;
  
  // 显示保存对话框让用户选择保存位置
  const baseName = path.basename(remotePath);
  const result = await dialog.showSaveDialog({
    title: '选择保存位置',
    defaultPath: path.join(os.homedir(), 'Downloads', baseName),
    buttonLabel: '保存'
  });
  
  // 用户取消了保存
  if (result.canceled || !result.filePath) {
    return null;
  }
  
  const localPath = result.filePath;
  
  // 用户已选择保存位置，开始下载
  if (onProgress) onProgress(10);
  
  if (platform === 'android') {
    const adb = getAdbPath();
    if (onProgress) onProgress(30);
    await execPromise(`"${adb}" -s "${deviceId}" pull "${remotePath}" "${localPath}"`);
    if (onProgress) onProgress(100);
    return localPath;
  } else if (platform === 'ios') {
    // iOS: bundleId 可选（越狱设备不需要）
    if (onProgress) onProgress(30);
    await downloadIosFile(deviceId, bundleId, remotePath, localPath);
    if (onProgress) onProgress(100);
    return localPath;
  }
  
  throw new Error('不支持的平台');
}

export async function downloadFileToTemp(args: { deviceId: string; platform: 'android' | 'ios'; remotePath: string, bundleId?: string }, onProgress?: (percent: number) => void): Promise<string> {
  const { deviceId, platform, remotePath, bundleId } = args;
  
  // 下载到临时目录
  const baseName = path.basename(remotePath);
  const localPath = path.join(os.tmpdir(), `mktools_${Date.now()}_${baseName}`);
  
  if (onProgress) onProgress(10);
  
  if (platform === 'android') {
    const adb = getAdbPath();
    if (onProgress) onProgress(30);
    await execPromise(`"${adb}" -s "${deviceId}" pull "${remotePath}" "${localPath}"`);
    if (onProgress) onProgress(100);
    return localPath;
  } else if (platform === 'ios') {
    // iOS: bundleId 可选（越狱设备不需要）
    if (onProgress) onProgress(30);
    await downloadIosFile(deviceId, bundleId, remotePath, localPath);
    if (onProgress) onProgress(100);
    return localPath;
  }
  
  throw new Error('不支持的平台');
}

export async function deleteTarget(args: { deviceId: string; platform: 'android' | 'ios'; targetPath: string, bundleId?: string }): Promise<void> {
  const { deviceId, platform, targetPath, bundleId } = args;
  if (platform === 'android') {
    const adb = getAdbPath();
    await execPromise(`"${adb}" -s "${deviceId}" shell rm -rf "${targetPath}"`);
    return;
  } else if (platform === 'ios') {
    // iOS: bundleId 可选（越狱设备不需要）
    await deleteIosFile(deviceId, bundleId, targetPath);
    return;
  }
  
  throw new Error('不支持的平台');
}

export async function mkdir(args: { deviceId: string; platform: 'android' | 'ios'; dirPath: string, bundleId?: string }): Promise<void> {
  const { deviceId, platform, dirPath, bundleId } = args;
  if (platform === 'android') {
    const adb = getAdbPath();
    await execPromise(`"${adb}" -s "${deviceId}" shell mkdir -p "${dirPath}"`);
    return;
  } else if (platform === 'ios') {
    // iOS: bundleId 可选（越狱设备不需要）
    await createIosDirectory(deviceId, bundleId, dirPath);
    return;
  }
  
  throw new Error('不支持的平台');
}

export async function renameFile(args: { deviceId: string; platform: 'android' | 'ios'; oldPath: string; newPath: string; bundleId?: string }): Promise<void> {
  const { deviceId, platform, oldPath, newPath, bundleId } = args;
  if (platform === 'android') {
    const adb = getAdbPath();
    await execPromise(`"${adb}" -s "${deviceId}" shell mv "${oldPath}" "${newPath}"`);
    return;
  } else if (platform === 'ios') {
    // iOS: bundleId 可选（越狱设备不需要）
    await renameIosFile(deviceId, bundleId, oldPath, newPath);
    return;
  }
  
  throw new Error('不支持的平台');
}

export async function createFile(args: { deviceId: string; platform: 'android' | 'ios'; filePath: string; bundleId?: string }): Promise<void> {
  const { deviceId, platform, filePath, bundleId } = args;
  if (platform === 'android') {
    const adb = getAdbPath();
    await execPromise(`"${adb}" -s "${deviceId}" shell touch "${filePath}"`);
    return;
  } else if (platform === 'ios') {
    // 如果没有 bundleId，检查是否越狱，使用 SSH
    if (!bundleId) {
      const isJailbroken = await isDeviceJailbroken(deviceId);
      if (isJailbroken) {
        // 越狱设备：使用 SSH 创建文件
        await iosSshService.createSshFile(deviceId, filePath);
        return;
      }
    }
    
    // 非越狱设备或有 bundleId：使用 AFC
    // 创建一个临时空文件
    const tmpFile = path.join(os.tmpdir(), `mktools_empty_${Date.now()}.tmp`);
    await fsp.writeFile(tmpFile, '', 'utf-8');
    try {
      await uploadIosFile(deviceId, bundleId, tmpFile, filePath);
    } finally {
      await fsp.unlink(tmpFile).catch(() => {});
    }
    return;
  }
  
  throw new Error('不支持的平台');
}

export async function upload(args: { deviceId: string; platform: 'android' | 'ios'; destPath: string, bundleId?: string }, onProgress?: (current: number, total: number, fileName: string) => void): Promise<{ files: string[] }> {
  const { deviceId, platform, destPath, bundleId } = args;
  
  // 先显示文件选择对话框
  const res = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  if (res.canceled || !res.filePaths || res.filePaths.length === 0) return { files: [] };
  
  const fileNames: string[] = res.filePaths.map(f => path.basename(f));
  const totalFiles = res.filePaths.length;
  
  if (platform === 'android') {
    const adb = getAdbPath();
    for (let i = 0; i < res.filePaths.length; i++) {
      const f = res.filePaths[i];
      const fileName = path.basename(f);
      if (onProgress) onProgress(i, totalFiles, fileName);
      await execPromise(`"${adb}" -s "${deviceId}" push "${f}" "${destPath}/"`);
      if (onProgress) onProgress(i + 1, totalFiles, fileName);
    }
    return { files: fileNames };
  } else if (platform === 'ios') {
    // iOS: bundleId 可选（越狱设备不需要）
    
    for (let i = 0; i < res.filePaths.length; i++) {
      const f = res.filePaths[i];
      const fileName = path.basename(f);
      if (onProgress) onProgress(i, totalFiles, fileName);
      const remotePath = destPath === '/' ? `/${fileName}` : `${destPath}/${fileName}`;
      await uploadIosFile(deviceId, bundleId, f, remotePath);
      if (onProgress) onProgress(i + 1, totalFiles, fileName);
    }
    return { files: fileNames };
  }
  
  throw new Error('不支持的平台');
}

export async function listIosApps(deviceId: string): Promise<{ bundleId: string, name: string }[]> {
  let installationProxy: any = null;
  
  try {
    // 方法1: 使用 appium-ios-device 获取应用列表
    const { services } = require('appium-ios-device');
    
    try {
      // 使用 Installation Proxy 服务获取用户安装的应用
      installationProxy = await services.startInstallationProxyService(deviceId);
      const apps = await installationProxy.listApplications({
        applicationType: 'User' // 只获取用户安装的应用
      });
      
      const result: { bundleId: string, name: string }[] = [];
      
      // apps 是一个对象，key 是 bundleId，value 是应用信息
      for (const [bundleId, appInfo] of Object.entries(apps)) {
        const info = appInfo as any;
        const name = info.CFBundleDisplayName || info.CFBundleName || bundleId;
        result.push({ bundleId, name });
      }
      
      // 关闭服务
      if (installationProxy && typeof installationProxy.close === 'function') {
        try {
          installationProxy.close();
        } catch (e) {
          // 忽略关闭错误
        }
      }
      
      return result.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      // 关闭服务
      if (installationProxy && typeof installationProxy.close === 'function') {
        try {
          installationProxy.close();
        } catch (err) {
          // 忽略关闭错误
        }
      }
      // 如果 appium-ios-device 失败，尝试使用 ideviceinstaller
      throw e;
    }
  } catch (e1) {
    // 方法2: 回退到 ideviceinstaller
    const installer = getIosToolPath('ideviceinstaller');
    if (!installer) {
      throw new Error('无法获取iOS应用列表：未找到 ideviceinstaller 工具，且 appium-ios-device 服务不可用');
    }
    
    try {
      const { stdout } = await execPromise(`"${installer}" -u "${deviceId}" -l`);
      const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
      const apps: { bundleId: string, name: string }[] = [];
      
      for (const line of lines) {
        // 匹配格式: com.example.app - App Name
        const m = line.match(/^([A-Za-z0-9\.\-\_]+)\s*-\s*(.+)$/);
        if (m) {
          apps.push({ bundleId: m[1], name: m[2] });
        }
      }
      
      if (apps.length === 0) {
        throw new Error('未找到任何应用');
      }
      
      return apps;
    } catch (e2: any) {
      throw new Error(`无法获取iOS应用列表: ${e2.message}`);
    }
  }
}

export async function getIosAppIcon(deviceId: string, bundleId: string): Promise<string | null> {
  // Use appium-ios-device to access container
  try {
     const { services } = require('appium-ios-device');
     // We need to access the app bundle to get the icon
     // Start Installation Proxy to get path
     const installationProxy = await services.startInstallationProxyService(deviceId);
     const apps = await installationProxy.listApplications({ applicationType: 'User' });
     const appInfo = apps[bundleId];
     installationProxy.close();

     if (!appInfo) return null;

     let iconFiles: string[] = [];
     if (appInfo.CFBundleIconFiles && Array.isArray(appInfo.CFBundleIconFiles)) {
        iconFiles = appInfo.CFBundleIconFiles;
     } else if (appInfo.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconFiles) {
        iconFiles = appInfo.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles;
     }

     if (iconFiles.length === 0) {
        // Fallback: look for AppIcon*.png
        iconFiles = ['AppIcon60x60', 'AppIcon'];
     }

     // Check if JB
     const jb = await checkJailbreak(deviceId);
     if (jb) {
        // Use SSH to cat file | base64
        const appPath = appInfo.Path; // e.g. /private/var/.../App.app
        
        // Try largest icons first if possible, but we iterate what we have
        // Reverse to try last (often largest?) or just try all.
        // Usually AppIcon60x60@3x.png is good.
        
        for (const iconName of iconFiles) {
           // iconName might not have extension
           const extensions = iconName.endsWith('.png') ? [''] : ['.png', '@3x.png', '@2x.png'];
           
           for (const ext of extensions) {
              const fullPath = `${appPath}/${iconName}${ext}`;
              try {
                 // cat | base64
                 // use quotes for path
                 const cmd = `cat '${fullPath}' | base64`;
                 const base64 = await iosSshService.execSshCommand(deviceId, cmd);
                 if (base64 && base64.trim().length > 100 && !base64.includes('No such file')) {
                    return base64.replace(/\s/g, '');
                 }
              } catch (e) {
                 // Continue to next
              }
           }
        }
     }

     return null; 
  } catch (e) {
     console.error(`Failed to get iOS icon for ${bundleId}:`, e);
     return null;
  }
}
