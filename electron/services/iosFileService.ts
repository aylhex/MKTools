import { services } from 'appium-ios-device';

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime?: string;
  permissions?: string;
}

// 获取 AFC 服务（通过 HouseArrest 访问应用容器）
async function getAfcService(deviceId: string, bundleId: string) {
  const houseArrestService = await services.startHouseArrestService(deviceId);
  const afcService = await houseArrestService.vendContainer(bundleId);
  return afcService;
}

// 使用 AFC 协议列出目录
export async function listIosDirectory(deviceId: string, bundleId: string, path: string): Promise<FileEntry[]> {
  try {
    const afcService = await getAfcService(deviceId, bundleId);
    
    // AFC 路径不需要前导斜杠，根目录用空字符串或 '.'
    const afcPath = path === '/' ? '.' : path.replace(/^\//, '');
    
    const entries = await afcService.listDirectory(afcPath);
    
    const result: FileEntry[] = [];
    for (const entry of entries) {
      // 跳过 . 和 ..
      if (entry === '.' || entry === '..') continue;
      
      const fullPath = afcPath === '.' ? entry : `${afcPath}/${entry}`;
      try {
        const stat = await afcService.getFileInfo(fullPath);
        
        result.push({
          name: entry,
          isDir: stat.st_ifmt === 'S_IFDIR',
          size: parseInt(stat.st_size || '0', 10),
          mtime: stat.st_mtime ? new Date(parseInt(stat.st_mtime, 10) * 1000).toISOString() : undefined
        });
      } catch (err) {
        // 如果获取文件信息失败，仍然添加基本信息
        result.push({
          name: entry,
          isDir: false,
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
export async function downloadIosFile(deviceId: string, bundleId: string, remotePath: string, localPath: string): Promise<void> {
  try {
    const afcService = await getAfcService(deviceId, bundleId);
    const afcPath = remotePath.replace(/^\//, '');
    
    // 使用流式读取
    const fs = require('fs');
    const readStream = await afcService.createReadStream(afcPath);
    const writeStream = fs.createWriteStream(localPath);
    
    await new Promise((resolve, reject) => {
      readStream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      readStream.on('error', reject);
    });
    
    afcService.close();
  } catch (err: any) {
    throw new Error(`无法下载文件: ${err.message}`);
  }
}

// 上传文件
export async function uploadIosFile(deviceId: string, bundleId: string, localPath: string, remotePath: string): Promise<void> {
  try {
    const afcService = await getAfcService(deviceId, bundleId);
    const afcPath = remotePath.replace(/^\//, '');
    
    // 使用流式写入
    const fs = require('fs');
    const readStream = fs.createReadStream(localPath);
    const writeStream = await afcService.createWriteStream(afcPath);
    
    await new Promise((resolve, reject) => {
      readStream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      readStream.on('error', reject);
    });
    
    afcService.close();
  } catch (err: any) {
    throw new Error(`无法上传文件: ${err.message}`);
  }
}

// 删除文件或目录
export async function deleteIosFile(deviceId: string, bundleId: string, remotePath: string): Promise<void> {
  try {
    const afcService = await getAfcService(deviceId, bundleId);
    const afcPath = remotePath.replace(/^\//, '');
    
    // 检查是否为目录
    const stat = await afcService.getFileInfo(afcPath);
    if (stat.st_ifmt === 'S_IFDIR') {
      await afcService.deleteDirectory(afcPath);
    } else {
      await afcService.deleteFile(afcPath);
    }
    
    afcService.close();
  } catch (err: any) {
    throw new Error(`无法删除文件: ${err.message}`);
  }
}

// 创建目录
export async function createIosDirectory(deviceId: string, bundleId: string, remotePath: string): Promise<void> {
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
export async function renameIosFile(deviceId: string, bundleId: string, oldPath: string, newPath: string): Promise<void> {
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
