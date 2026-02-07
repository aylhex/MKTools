import path from 'node:path';

/**
 * 修复 macOS/Linux 上的 PATH 问题
 * 确保能找到常用的命令
 */
export function fixPath() {
  if (process.platform === 'win32') return;
  
  // 强制硬编码常见路径，防止 execSync 失败
  const commonPaths = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/Users/' + process.env.USER + '/Library/Android/sdk/platform-tools'
  ];
  
  process.env.PATH = (process.env.PATH || '') + ':' + commonPaths.join(':');
}

/**
 * 获取 iOS 工具的运行环境变量
 * 主要是为了设置动态库加载路径 (DYLD_LIBRARY_PATH / LD_LIBRARY_PATH)
 */
export function getIosEnv(toolPath: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  
  // 如果使用的是内置工具 (包含绝对路径)，则设置动态库加载路径
  if (toolPath && path.isAbsolute(toolPath)) {
    const binDir = path.dirname(toolPath);
    
    if (process.platform === 'darwin') {
        // macOS: DYLD_LIBRARY_PATH
        env.DYLD_LIBRARY_PATH = (env.DYLD_LIBRARY_PATH || '') + ':' + binDir;
        // 同时也设置 DYLD_FALLBACK_LIBRARY_PATH 以防万一
        env.DYLD_FALLBACK_LIBRARY_PATH = (env.DYLD_FALLBACK_LIBRARY_PATH || '') + ':' + binDir + ':/usr/lib:/usr/local/lib';
    } else if (process.platform === 'linux') {
        // Linux: LD_LIBRARY_PATH
        env.LD_LIBRARY_PATH = (env.LD_LIBRARY_PATH || '') + ':' + binDir;
    }
    // Windows 默认会搜索 exe 同级目录，通常不需要额外设置 PATH，但为了保险也可以加
    if (process.platform === 'win32') {
        env.PATH = (env.PATH || '') + ';' + binDir;
    }
  }
  
  return env;
}
