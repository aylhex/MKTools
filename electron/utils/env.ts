import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * 修复 macOS/Linux 上的 PATH 问题
 * 确保能找到常用的命令（尤其是 frida-ps、frida 这类通过 pip 安装到用户目录的工具）
 *
 * 背景：
 * - macOS/Linux 上 GUI 应用（Electron 打包/dev 启动的应用）继承的是 launchd 的 PATH，
 *   不会加载用户 shell（zsh/bash）在 rc 文件里的 PATH。
 * - `pip install frida-tools` 常见的落地位置：
 *     · macOS 系统 Python:  ~/Library/Python/<ver>/bin
 *     · Homebrew Python:    /opt/homebrew/opt/python@<ver>/libexec/bin 或 /opt/homebrew/bin
 *     · pyenv:              ~/.pyenv/shims、~/.pyenv/versions/<ver>/bin
 *     · pipx:               ~/.local/bin
 * - 如果这些目录不在 PATH 里，`checkJailbreak` 中的 `frida-ps -D <deviceId>` 会直接报
 *   "command not found"，导致越狱设备被误判为"未越狱"。
 */
export function fixPath() {
  if (process.platform === 'win32') {
    // Windows 上 Python 通过 py.exe launcher 或 %APPDATA%\Python\Python<ver>\Scripts 提供
    const winExtra = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
      process.env.APPDATA ? path.join(process.env.APPDATA, 'Python') : '',
    ].filter(Boolean);
    if (winExtra.length > 0) {
      process.env.PATH = (process.env.PATH || '') + ';' + winExtra.join(';');
    }
    return;
  }

  const home = process.env.HOME || `/Users/${process.env.USER}`;

  // 1) 基础系统路径 + 各类包管理器 + Python/pip 相关路径（frida-tools 常见落地）
  const basePaths: string[] = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    // Android SDK
    path.join(home, 'Library/Android/sdk/platform-tools'),
    path.join(home, 'Android/Sdk/platform-tools'),
    // pipx / cargo / 用户级 bin（frida-tools 通过 pipx 安装时在这里）
    path.join(home, '.local/bin'),
    path.join(home, '.cargo/bin'),
    // pyenv
    path.join(home, '.pyenv/shims'),
    path.join(home, '.pyenv/bin'),
    // Homebrew Python（各版本的 libexec/bin 里含 pip 装的脚本）
    '/opt/homebrew/opt/python@3.13/libexec/bin',
    '/opt/homebrew/opt/python@3.12/libexec/bin',
    '/opt/homebrew/opt/python@3.11/libexec/bin',
    '/opt/homebrew/opt/python@3.10/libexec/bin',
    '/opt/homebrew/opt/python@3.9/libexec/bin',
    '/usr/local/opt/python@3.13/libexec/bin',
    '/usr/local/opt/python@3.12/libexec/bin',
    '/usr/local/opt/python@3.11/libexec/bin',
    '/usr/local/opt/python@3.10/libexec/bin',
    '/usr/local/opt/python@3.9/libexec/bin',
  ];

  // 2) macOS 系统 Python 的用户级 bin：~/Library/Python/<ver>/bin
  //    这是 `pip3 install --user frida-tools` 默认落地的地方
  const macUserPythonBase = path.join(home, 'Library/Python');
  try {
    if (fs.existsSync(macUserPythonBase)) {
      for (const ver of fs.readdirSync(macUserPythonBase)) {
        const p = path.join(macUserPythonBase, ver, 'bin');
        if (fs.existsSync(p)) basePaths.push(p);
      }
    }
  } catch {
    /* 目录不可读则忽略 */
  }

  // 3) pyenv versions/<ver>/bin —— 覆盖每一个已安装 Python 版本的 bin
  const pyenvVersionsDir = path.join(home, '.pyenv/versions');
  try {
    if (fs.existsSync(pyenvVersionsDir)) {
      for (const ver of fs.readdirSync(pyenvVersionsDir)) {
        const p = path.join(pyenvVersionsDir, ver, 'bin');
        if (fs.existsSync(p)) basePaths.push(p);
      }
    }
  } catch {
    /* 忽略 */
  }

  // 4) 尝试从用户默认 shell（zsh/bash）继承一次 PATH，兜底覆盖任何自定义环境
  //    只在 macOS/Linux 尝试，失败静默
  let shellPath = '';
  try {
    const userShell = process.env.SHELL || '/bin/zsh';
    // 用交互式登录 shell（-i -l -c）触发 rc 文件加载
    shellPath = execSync(`${userShell} -ilc 'echo -n $PATH'`, {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    /* 拿不到就算了 */
  }

  // 合并并去重（保持顺序：原 PATH 在前，兜底路径在后，shell PATH 追加末尾）
  const seen = new Set<string>();
  const merged: string[] = [];
  const addAll = (paths: string[]) => {
    for (const p of paths) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      merged.push(p);
    }
  };
  addAll((process.env.PATH || '').split(':'));
  addAll(basePaths);
  addAll(shellPath.split(':'));

  process.env.PATH = merged.join(':');
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

/**
 * 在扩展后的 PATH 里定位一个可执行文件的绝对路径。
 * 找不到返回空字符串。
 *
 * 用途：即便 `frida-ps` 已经能被 `execPromise` 找到，主动拿到绝对路径写入命令行
 * 也能规避 shell 未继承 PATH 的边缘情况。
 */
export function resolveExecutable(cmd: string): string {
  if (process.platform === 'win32') {
    // Windows 场景暂不深入处理
    return cmd;
  }
  const pathEntries = (process.env.PATH || '').split(':');
  for (const dir of pathEntries) {
    if (!dir) continue;
    const full = path.join(dir, cmd);
    try {
      if (fs.existsSync(full)) {
        return full;
      }
    } catch {
      /* 忽略 */
    }
  }
  // 最后用 which 兜底一次（此时 PATH 已包含 shell 里的内容）
  try {
    const out = execSync(`command -v ${cmd}`, {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return out;
  } catch {
    /* 忽略 */
  }
  return '';
}
