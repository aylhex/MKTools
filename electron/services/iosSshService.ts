import { exec, spawn, ChildProcess } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { getIproxyPath, getSshpassPath } from '../utils/paths';

const execPromise = util.promisify(exec);

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime?: string;
  permissions?: string;
}

// 存储每个设备的 iproxy 进程
const iproxyProcesses = new Map<string, ChildProcess>();

// 启动 iproxy 端口转发
async function startIproxy(deviceId: string, localPort: number = 2222): Promise<void> {
  // 如果已经有进程在运行，先停止
  if (iproxyProcesses.has(deviceId)) {
    const existingProcess = iproxyProcesses.get(deviceId);
    existingProcess?.kill();
    iproxyProcesses.delete(deviceId);
    // 等待进程完全停止
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return new Promise((resolve, reject) => {
    const iproxyPath = getIproxyPath();
    if (!iproxyPath) {
      reject(new Error('iproxy 工具未找到，请确保已安装 libimobiledevice'));
      return;
    }
    
    console.log(`[iproxy] Starting iproxy for device ${deviceId} on port ${localPort}`);
    console.log(`[iproxy] Using iproxy at: ${iproxyPath}`);
    
    // 新版 iproxy 语法: iproxy LOCAL_PORT:DEVICE_PORT -u UDID
    const iproxy = spawn(iproxyPath, [`${localPort}:22`, '-u', deviceId]);
    
    let resolved = false;
    let output = '';
    
    // 监听输出以确认启动
    iproxy.stdout?.on('data', (data) => {
      output += data.toString();
      console.log(`[iproxy] stdout: ${data.toString().trim()}`);
    });
    
    iproxy.stderr?.on('data', (data) => {
      output += data.toString();
      console.log(`[iproxy] stderr: ${data.toString().trim()}`);
    });
    
    // 等待端口转发建立 - 增加到 3 秒
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        iproxyProcesses.set(deviceId, iproxy);
        console.log(`[iproxy] Process started, waiting for connection to establish...`);
        resolve();
      }
    }, 3000);
    
    iproxy.on('error', (err) => {
      console.error(`[iproxy] Error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        reject(new Error(`iproxy 启动失败: ${err.message}`));
      }
    });
    
    iproxy.on('exit', (code) => {
      console.log(`[iproxy] Process exited with code ${code}`);
      iproxyProcesses.delete(deviceId);
    });
  });
}

// 停止 iproxy
export function stopIproxy(deviceId: string): void {
  const process = iproxyProcesses.get(deviceId);
  if (process) {
    process.kill();
    iproxyProcesses.delete(deviceId);
  }
}

// 检测设备是否越狱（通过尝试 SSH 连接）
export async function checkJailbreak(deviceId: string): Promise<boolean> {
  try {
    const sshpassPath = getSshpassPath();
    if (!sshpassPath) {
      console.log('[Jailbreak Check] sshpass not found, cannot check jailbreak status');
      return false;
    }
    
    console.log(`[Jailbreak Check] Starting check for device: ${deviceId}`);
    console.log(`[Jailbreak Check] Using sshpass at: ${sshpassPath}`);
    
    // 启动 iproxy
    await startIproxy(deviceId, 2222);
    console.log(`[Jailbreak Check] iproxy started, waiting for connection to stabilize...`);
    
    // 额外等待 2 秒让连接稳定
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`[Jailbreak Check] Attempting SSH connection...`);
    
    // 尝试 SSH 连接（使用默认密码 alpine）
    const { stdout } = await execPromise(
      `"${sshpassPath}" -p alpine ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -p 2222 root@localhost "echo jailbroken"`,
      { timeout: 10000 }
    );
    
    const result = stdout.trim() === 'jailbroken';
    console.log(`[Jailbreak Check] SSH test result: ${result}, stdout: "${stdout.trim()}"`);
    return result;
  } catch (err: any) {
    console.log(`[Jailbreak Check] Failed - device is not jailbroken or SSH not accessible: ${err.message}`);
    return false;
  }
}

// 执行任意 SSH 命令
export async function execSshCommand(deviceId: string, command: string): Promise<string> {
  try {
    const sshpassPath = getSshpassPath();
    if (!sshpassPath) {
      throw new Error('sshpass 工具未找到');
    }
    
    // 确保 iproxy 正在运行
    if (!iproxyProcesses.has(deviceId)) {
      await startIproxy(deviceId, 2222);
    }
    
    // 执行命令
    const { stdout } = await execPromise(
      `"${sshpassPath}" -p alpine ssh -o StrictHostKeyChecking=no -p 2222 root@localhost "${command.replace(/"/g, '\\"')}"`,
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    
    return stdout;
  } catch (err: any) {
    throw new Error(`SSH 命令执行失败: ${err.message}`);
  }
}

// 通过 SSH 列出目录
export async function listSshDirectory(deviceId: string, dirPath: string): Promise<FileEntry[]> {
  try {
    const sshpassPath = getSshpassPath();
    if (!sshpassPath) {
      throw new Error('sshpass 工具未找到');
    }
    
    // 确保 iproxy 正在运行
    if (!iproxyProcesses.has(deviceId)) {
      await startIproxy(deviceId, 2222);
    }
    
    // 使用 ls -la 获取详细信息
    const { stdout } = await execPromise(
      `"${sshpassPath}" -p alpine ssh -o StrictHostKeyChecking=no -p 2222 root@localhost "ls -la '${dirPath.replace(/'/g, "'\\''")}'"`,
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
          `"${sshpassPath}" -p alpine ssh -o StrictHostKeyChecking=no -p 2222 root@localhost '${commands}'`,
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
  try {
    const sshpassPath = getSshpassPath();
    if (!sshpassPath) {
      throw new Error('sshpass 工具未找到');
    }
    
    // 确保 iproxy 正在运行
    if (!iproxyProcesses.has(deviceId)) {
      await startIproxy(deviceId, 2222);
    }
    
    // 使用 scp 下载文件
    await execPromise(
      `"${sshpassPath}" -p alpine scp -o StrictHostKeyChecking=no -P 2222 root@localhost:'${remotePath.replace(/'/g, "'\\''")}' '${localPath}'`,
      { timeout: 60000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 下载文件失败: ${err.message}`);
  }
}

// 通过 SSH 上传文件
export async function uploadSshFile(deviceId: string, localPath: string, remotePath: string): Promise<void> {
  try {
    const sshpassPath = getSshpassPath();
    if (!sshpassPath) {
      throw new Error('sshpass 工具未找到');
    }
    
    // 确保 iproxy 正在运行
    if (!iproxyProcesses.has(deviceId)) {
      await startIproxy(deviceId, 2222);
    }
    
    // 使用 scp 上传文件
    await execPromise(
      `"${sshpassPath}" -p alpine scp -o StrictHostKeyChecking=no -P 2222 '${localPath}' root@localhost:'${remotePath.replace(/'/g, "'\\'")}'`,
      { timeout: 60000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 上传文件失败: ${err.message}`);
  }
}

// 通过 SSH 删除文件或目录
export async function deleteSshFile(deviceId: string, remotePath: string): Promise<void> {
  try {
    const sshpassPath = getSshpassPath();
    if (!sshpassPath) {
      throw new Error('sshpass 工具未找到');
    }
    
    // 确保 iproxy 正在运行
    if (!iproxyProcesses.has(deviceId)) {
      await startIproxy(deviceId, 2222);
    }
    
    // 使用 rm -rf 删除
    await execPromise(
      `"${sshpassPath}" -p alpine ssh -o StrictHostKeyChecking=no -p 2222 root@localhost "rm -rf '${remotePath.replace(/'/g, "'\\''")}'"`,
      { timeout: 10000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 删除失败: ${err.message}`);
  }
}

// 通过 SSH 创建目录
export async function createSshDirectory(deviceId: string, remotePath: string): Promise<void> {
  try {
    const sshpassPath = getSshpassPath();
    if (!sshpassPath) {
      throw new Error('sshpass 工具未找到');
    }
    
    // 确保 iproxy 正在运行
    if (!iproxyProcesses.has(deviceId)) {
      await startIproxy(deviceId, 2222);
    }
    
    // 使用 mkdir -p 创建目录
    await execPromise(
      `"${sshpassPath}" -p alpine ssh -o StrictHostKeyChecking=no -p 2222 root@localhost "mkdir -p '${remotePath.replace(/'/g, "'\\''")}'"`,
      { timeout: 10000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 创建目录失败: ${err.message}`);
  }
}

// 通过 SSH 重命名文件
export async function renameSshFile(deviceId: string, oldPath: string, newPath: string): Promise<void> {
  try {
    const sshpassPath = getSshpassPath();
    if (!sshpassPath) {
      throw new Error('sshpass 工具未找到');
    }
    
    // 确保 iproxy 正在运行
    if (!iproxyProcesses.has(deviceId)) {
      await startIproxy(deviceId, 2222);
    }
    
    // 使用 mv 重命名
    await execPromise(
      `"${sshpassPath}" -p alpine ssh -o StrictHostKeyChecking=no -p 2222 root@localhost "mv '${oldPath.replace(/'/g, "'\\''")}' '${newPath.replace(/'/g, "'\\''")}'"`,
      { timeout: 10000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 重命名失败: ${err.message}`);
  }
}

// 通过 SSH 创建文件
export async function createSshFile(deviceId: string, remotePath: string): Promise<void> {
  try {
    const sshpassPath = getSshpassPath();
    if (!sshpassPath) {
      throw new Error('sshpass 工具未找到');
    }
    
    // 确保 iproxy 正在运行
    if (!iproxyProcesses.has(deviceId)) {
      await startIproxy(deviceId, 2222);
    }
    
    // 使用 touch 创建文件
    await execPromise(
      `"${sshpassPath}" -p alpine ssh -o StrictHostKeyChecking=no -p 2222 root@localhost "touch '${remotePath.replace(/'/g, "'\\''")}'"`,
      { timeout: 10000 }
    );
  } catch (err: any) {
    throw new Error(`SSH 创建文件失败: ${err.message}`);
  }
}
