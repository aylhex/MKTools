import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// 图标缓存目录
function getCacheDir(): string {
  const cacheDir = path.join(os.homedir(), '.mktools', 'icon-cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

// 生成缓存键
function getCacheKey(deviceId: string, platform: string, packageName: string): string {
  const hash = crypto.createHash('md5').update(`${deviceId}-${platform}-${packageName}`).digest('hex');
  return hash;
}

// 获取缓存文件路径
function getCachePath(cacheKey: string): string {
  return path.join(getCacheDir(), `${cacheKey}.png`);
}

// 保存图标到缓存（已经是压缩后的 Base64）
export async function saveIconToCache(
  deviceId: string,
  platform: string,
  packageName: string,
  base64Data: string
): Promise<void> {
  try {
    const cacheKey = getCacheKey(deviceId, platform, packageName);
    const cachePath = getCachePath(cacheKey);
    
    // 保存到文件
    const buffer = Buffer.from(base64Data, 'base64');
    await fs.promises.writeFile(cachePath, buffer);
    
    console.log(`[Cache] Saved icon for ${packageName}`);
  } catch (e) {
    console.error(`[Cache] Failed to save icon for ${packageName}:`, e);
  }
}

// 从缓存读取图标
export async function getIconFromCache(
  deviceId: string,
  platform: string,
  packageName: string
): Promise<string | null> {
  try {
    const cacheKey = getCacheKey(deviceId, platform, packageName);
    const cachePath = getCachePath(cacheKey);
    
    if (!fs.existsSync(cachePath)) {
      return null;
    }
    
    // 读取文件
    const buffer = await fs.promises.readFile(cachePath);
    const base64 = buffer.toString('base64');
    
    console.log(`[Cache] Loaded icon for ${packageName} from cache`);
    return base64;
  } catch (e) {
    console.error(`[Cache] Failed to load icon for ${packageName}:`, e);
    return null;
  }
}

// 批量保存图标
export async function saveIconsBatch(
  deviceId: string,
  platform: string,
  apps: Array<{ packageName: string; icon: string }>
): Promise<void> {
  const promises = apps
    .filter(app => app.icon && app.icon.length > 0)
    .map(app => saveIconToCache(deviceId, platform, app.packageName, app.icon));
  
  await Promise.allSettled(promises);
}

// 批量读取图标
export async function getIconsBatch(
  deviceId: string,
  platform: string,
  packageNames: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  const promises = packageNames.map(async (packageName) => {
    const icon = await getIconFromCache(deviceId, platform, packageName);
    if (icon) {
      results.set(packageName, icon);
    }
  });
  
  await Promise.allSettled(promises);
  return results;
}

// 清理缓存
export async function clearIconCache(): Promise<void> {
  try {
    const cacheDir = getCacheDir();
    const files = await fs.promises.readdir(cacheDir);
    
    for (const file of files) {
      await fs.promises.unlink(path.join(cacheDir, file));
    }
    
    console.log(`[Cache] Cleared ${files.length} cached icons`);
  } catch (e) {
    console.error('[Cache] Failed to clear cache:', e);
  }
}

// 获取缓存统计
export async function getCacheStats(): Promise<{ count: number; size: number }> {
  try {
    const cacheDir = getCacheDir();
    const files = await fs.promises.readdir(cacheDir);
    
    let totalSize = 0;
    for (const file of files) {
      const stat = await fs.promises.stat(path.join(cacheDir, file));
      totalSize += stat.size;
    }
    
    return {
      count: files.length,
      size: totalSize
    };
  } catch (e) {
    return { count: 0, size: 0 };
  }
}
