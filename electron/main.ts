import { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { URL as NodeURL } from 'node:url'
import { fixPath } from './utils/env'
import { getDevices, getAndroidApps, getAndroidAppIcon, getAndroidPackagePids, checkAndroidRoot } from './services/deviceService'
import { startLogging, stopLogging } from './services/logService'
import { listDirectory, downloadFile, downloadFileToTemp, deleteTarget, mkdir, upload, listIosApps, renameFile, createFile, checkJailbreak, getIosAppIcon, clearJailbreakCache, setForcedJailbreak, unsetForcedJailbreak } from './services/fileService'
import { getKeystoreAliases, analyzeApk, resignApk, getIosIdentities, resignIpa, injectAndResignApk, decompileApkForEdit, resignFromDecompiled, cleanupDecompileSession, DecompileSession } from './services/signerService'
import { installApp, installAppFromDevice } from './services/installService'
import { stopAllIproxy } from './services/iosSshService'
import { decryptApp } from './services/fridaService'
import { getBuildToolsPath } from './utils/paths'
import { saveIconToCache, getIconFromCache, getIconsBatch, clearIconCache, getCacheStats } from './services/iconCacheService'

console.log('[Main] Starting Electron Main Process...');

// 在 macOS 开发模式下强制设置应用名称
if (process.platform === 'darwin') {
  // 设置环境变量（影响 Dock 和菜单栏）
  process.env.CFBundleName = 'MKTools';
  process.env.CFBundleDisplayName = 'MKTools';
}

// 必须在最开始设置应用名称（在任何其他操作之前）
app.setName('MKTools');

// 修复 macOS/Linux 上的 PATH 问题
fixPath()

// 尽早注册 IPC 处理程序（模块加载时立即注册，避免任何时序问题）
// safeHandle 在内部调用 ipcMain.removeHandler，处理热重载重复注册问题
setupIpcHandlers();

// 设置 About 面板信息（macOS）
if (process.platform === 'darwin') {
  // 根据是否打包选择图标路径
  const iconPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'app.asar', 'dist', 'icon.png')
    : path.join(__dirname, '../public/icon.png');
    
  app.setAboutPanelOptions({
    applicationName: 'MKTools',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright © 2026',
    credits: 'A powerful mobile development tool',
    iconPath: iconPath
  });
}

// The built directory structure
//
// ├─┬─ dist
// │ ├─ index.html
// │ ├─ assets
// │ └─ index.js
// ├─┬─ dist-electron
// │ ├─ main.js
// │ └─ preload.js
//
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '../public')

let win: BrowserWindow | null
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  console.log('[Main] Creating window...');
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'MKTools',
    icon: process.env.VITE_PUBLIC ? path.join(process.env.VITE_PUBLIC, 'icon.png') : undefined,
    show: false, // 先隐藏窗口，等待内容加载完成
    backgroundColor: '#09090b', // 设置默认背景色为 zinc-950 (深色模式默认值)，避免白色闪烁
    opacity: 0, // 初始透明度为0，用于实现淡入动画
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // 当页面准备好显示时再显示窗口，并执行淡入动画
  win.once('ready-to-show', () => {
    if (!win) return;
    win.show();
    
    // 淡入动画
    let opacity = 0;
    const step = 0.05; // 每次增加的透明度
    const interval = 10; // 间隔时间(ms)
    
    const fadeTimer = setInterval(() => {
      if (!win || win.isDestroyed()) {
        clearInterval(fadeTimer);
        return;
      }
      
      opacity += step;
      if (opacity >= 1) {
        opacity = 1;
        clearInterval(fadeTimer);
      }
      win.setOpacity(opacity);
    }, interval);
  });

  // Right-click context menu (select / copy / paste / cut)
  win.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut', enabled: params.editFlags.canCut }))
      menu.append(new MenuItem({ role: 'copy', enabled: params.editFlags.canCopy }))
      menu.append(new MenuItem({ role: 'paste', enabled: params.editFlags.canPaste }))
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }))
    }
    if (menu.items.length > 0) menu.popup({ window: win! })
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    if (process.env.DIST) {
        win.loadFile(path.join(process.env.DIST, 'index.html'))
    } else {
        console.error('DIST environment variable is undefined');
    }
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  // 清理所有后台子进程，避免应用退出后遗留僵尸进程 / 端口占用（logcat、idevicesyslog、iproxy 等）
  try { stopLogging(); } catch (_) {}
  try { stopAllIproxy(); } catch (_) {}
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    try { setupIpcHandlers(); } catch (_) {}
    createWindow()
  }
})

app.whenReady().then(() => {
  console.log('[Main] App is ready');

  // 再次强制设置应用名称（确保在 ready 后生效）
  try { app.setName('MKTools'); } catch (_) {}

  // 在 macOS 上设置 Dock 图标
  try {
    if (process.platform === 'darwin' && process.env.VITE_PUBLIC) {
      const iconPath = path.join(process.env.VITE_PUBLIC, 'icon.png')
      if (app.dock) {
        app.dock.setIcon(iconPath)
      }
    }
  } catch (e) {
    console.warn('[Main] Failed to set dock icon:', e);
  }

  // 设置应用菜单（确保显示正确的应用名称）
  try {
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'MKTools',
        submenu: [
          {
            label: 'About MKTools',
            role: 'about'
          },
          { type: 'separator' },
          {
            label: 'Services',
            role: 'services'
          },
          { type: 'separator' },
          {
            label: 'Hide MKTools',
            accelerator: 'Command+H',
            role: 'hide'
          },
          {
            label: 'Hide Others',
            accelerator: 'Command+Alt+H',
            role: 'hideOthers'
          },
          {
            label: 'Show All',
            role: 'unhide'
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: 'Command+Q',
            click: () => {
              app.quit()
            }
          }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' }
        ]
      }
    ]
    
    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }
  } catch (e) {
    console.warn('[Main] Failed to build menu:', e);
  }

  // 注册 IPC 处理程序（必须在创建窗口之前注册，以防页面加载过快导致竞态条件）
  try {
    setupIpcHandlers()
  } catch (error) {
    console.error('[Main] Failed to setup IPC handlers:', error);
  }

  try {
    createWindow()
  } catch (error) {
    console.error('[Main] Failed to create window:', error);
  }
})


function setupIpcHandlers() {
  console.log('[IPC] Setting up IPC handlers...');

  // Safe wrapper: removes any existing handler before registering, so hot-reload
  // in dev mode never throws "Attempted to register a second handler for '<channel>'".
  function safeHandle(channel: string, handler: Parameters<typeof ipcMain.handle>[1]) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }

  try {
    safeHandle('get-devices', async () => {
    console.log('[IPC] get-devices handler called');
    try {
      const devices = await getDevices();
      return devices;
    } catch (e) {
      console.error('[IPC] get-devices failed:', e);
      throw e;
    }
  })
  console.log('[IPC] Registered: get-devices');

  safeHandle('get-installed-apps', async (_event, args: { deviceId: string; platform: 'android' | 'ios' }) => {
      console.log(`[IPC] get-installed-apps handler called for ${args.platform} device ${args.deviceId}`);
      try {
        if (args.platform === 'android') {
          return await getAndroidApps(args.deviceId);
        } else if (args.platform === 'ios') {
          return await listIosApps(args.deviceId);
        }
        return [];
      } catch (e) {
        console.error('[IPC] get-installed-apps failed:', e);
        throw e;
      }
    })

    safeHandle('get-package-pids', async (_event, args: { deviceId: string; packageName: string }) => {
      try {
        return await getAndroidPackagePids(args.deviceId, args.packageName);
      } catch (e) {
        console.error('[IPC] get-package-pids failed:', e);
        return [];
      }
    })

    safeHandle('check-android-root', async (_event, args: { deviceId: string }) => {
      try {
        return await checkAndroidRoot(args.deviceId);
      } catch (e) {
        console.error('[IPC] check-android-root failed:', e);
        return false;
      }
    })

    safeHandle('get-app-icon', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; packageName: string }) => {
      try {
        if (args.platform === 'android') {
          return await getAndroidAppIcon(args.deviceId, args.packageName);
        } else if (args.platform === 'ios') {
          return await getIosAppIcon(args.deviceId, args.packageName);
        }
        return null;
      } catch (e) {
        console.error('[IPC] get-app-icon failed:', e);
        return null;
      }
    })

    safeHandle('decrypt-app', async (event, args: { deviceId: string; platform: 'android' | 'ios'; bundleId: string; outputDir?: string }) => {
      console.log(`[IPC] decrypt-app handler called for ${args.bundleId} on ${args.platform}`);
      try {
        const result = await decryptApp(args, (msg) => {
           event.sender.send('decrypt-log', msg);
        });
        return result;
      } catch (e: any) {
        console.error('[IPC] decrypt-app failed:', e);
        throw e;
      }
    })

    safeHandle('extract-ios-headers', async (event, args: { ipaPath: string }) => {
      console.log(`[IPC] extract-ios-headers handler called for ${args.ipaPath}`);
      try {
        const { extractIosHeaders } = await import('./services/fridaService');
        const result = await extractIosHeaders(args.ipaPath, (msg) => {
          event.sender.send('decrypt-log', msg);
        });
        return result;
      } catch (e: any) {
        console.error('[IPC] extract-ios-headers failed:', e);
        throw e;
      }
    })

    safeHandle('fetch-frida-app-list', async (event, args: { deviceId: string; platform: 'android' | 'ios' }) => {
      console.log(`[IPC] fetch-frida-app-list handler called for ${args.platform} device ${args.deviceId}`);
      try {
        // Dynamic import to avoid circular dependencies if any, though imports are top-level usually.
        // Importing fetchAppListViaFrida from service
        const { fetchAppListViaFrida } = await import('./services/fridaService');
        const result = await fetchAppListViaFrida(args.deviceId, args.platform, (msg) => {
           console.log(`[FridaList] ${msg}`);
           // Send logs to renderer so user can see progress in the UI log panel
           event.sender.send('decrypt-log', msg);
        });
        return result;
      } catch (e: any) {
        console.error('[IPC] fetch-frida-app-list failed:', e);
        // Return empty list on failure rather than throwing, to allow graceful degradation
        return [];
      }
    })
    
    // Icon cache handlers
    safeHandle('save-icon-to-cache', async (_event, args: { deviceId: string; platform: string; packageName: string; icon: string }) => {
      try {
        await saveIconToCache(args.deviceId, args.platform, args.packageName, args.icon);
        return true;
      } catch (e: any) {
        console.error('[IPC] save-icon-to-cache failed:', e);
        return false;
      }
    })
    
    safeHandle('get-icon-from-cache', async (_event, args: { deviceId: string; platform: string; packageName: string }) => {
      try {
        return await getIconFromCache(args.deviceId, args.platform, args.packageName);
      } catch (e: any) {
        console.error('[IPC] get-icon-from-cache failed:', e);
        return null;
      }
    })
    
    safeHandle('get-icons-from-cache', async (_event, args: { deviceId: string; platform: string; packageNames: string[] }) => {
      try {
        const iconsMap = await getIconsBatch(args.deviceId, args.platform, args.packageNames);
        // Convert Map to plain object for IPC
        const result: Record<string, string> = {};
        iconsMap.forEach((value, key) => {
          result[key] = value;
        });
        return result;
      } catch (e: any) {
        console.error('[IPC] get-icons-from-cache failed:', e);
        return {};
      }
    })
    
    safeHandle('clear-icon-cache', async () => {
      try {
        await clearIconCache();
        return true;
      } catch (e: any) {
        console.error('[IPC] clear-icon-cache failed:', e);
        return false;
      }
    })
    
    safeHandle('get-cache-stats', async () => {
      try {
        return await getCacheStats();
      } catch (e: any) {
        console.error('[IPC] get-cache-stats failed:', e);
        return { count: 0, size: 0 };
      }
    })
  } catch (error) {
    console.error('[IPC] Failed to register get-devices:', error);
  }

  ipcMain.on('start-log', async (event, args) => {
    startLogging(event, args);
  })

  ipcMain.on('stop-log', () => {
    stopLogging();
  })

  // File System Handlers
  try {
    safeHandle('fs-list', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; path: string, bundleId?: string, skipSymlinkResolution?: boolean }) => {
      try {
        return await listDirectory(args, args.skipSymlinkResolution || false);
      } catch (err: any) {
        const msg = err?.message || String(err);
        // 权限受限（Android: Permission denied / iOS: Operation not permitted）当作合法业务结果返回，
        // 让前端展示琥珀色友好卡片；不再作为异常抛出，避免 Electron 在主进程 stdout 打印
        // "Error occurred in handler for 'fs-list'" 噪音日志。
        // 返回一个非数组的结构体，前端用 Array.isArray 判断是否是"权限受限"响应。
        if (/Permission denied|Operation not permitted|cannot open directory/i.test(msg)) {
          console.log(`[fs-list] Permission denied for ${args.path}: ${msg.slice(0, 200)}`);
          return { permissionDenied: true, message: msg, path: args.path };
        }
        throw err;
      }
    })

    safeHandle('fs-download', async (event, args: { deviceId: string; platform: 'android' | 'ios'; remotePath: string, bundleId?: string }) => {
      const result = await downloadFile(args, (percent) => {
        event.sender.send('download-progress', { percent, completed: percent === 100 });
      });
      return result;
    })

    safeHandle('fs-download-temp', async (event, args: { deviceId: string; platform: 'android' | 'ios'; remotePath: string, bundleId?: string }) => {
      const result = await downloadFileToTemp(args, (percent) => {
        event.sender.send('download-progress', { percent, completed: percent === 100 });
      });
      return result;
    })

    safeHandle('install-app', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; filePath: string; fileType: 'apk' | 'ipa' }) => {
      await installApp(args.deviceId, args.platform, args.filePath, args.fileType);
      return true;
    })

    safeHandle('install-app-from-device', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; devicePath: string; fileType: 'apk' | 'ipa' }) => {
      await installAppFromDevice(args.deviceId, args.platform, args.devicePath, args.fileType);
      return true;
    })

    safeHandle('select-local-file', async (_event, args: { filters: { name: string; extensions: string[] }[] }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: args.filters
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      
      return result.filePaths[0];
    })

    safeHandle('fs-delete', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; targetPath: string, bundleId?: string }) => {
      await deleteTarget(args);
      return true;
    })

    safeHandle('fs-mkdir', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; dirPath: string, bundleId?: string }) => {
      await mkdir(args);
      return true;
    })

    safeHandle('fs-rename', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; oldPath: string; newPath: string; bundleId?: string }) => {
      await renameFile(args);
      return true;
    })

    safeHandle('fs-create-file', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; filePath: string; bundleId?: string }) => {
      await createFile(args);
      return true;
    })

    safeHandle('fs-upload', async (event, args: { deviceId: string; platform: 'android' | 'ios'; destPath: string, bundleId?: string }) => {
      return await upload(args, (current, total, fileName) => {
        const percent = Math.round((current / total) * 100);
        event.sender.send('upload-progress', { current, total, percent, fileName });
      });
    })

    safeHandle('check-jailbreak', async (_event, args: { deviceId: string }) => {
      return await checkJailbreak(args.deviceId);
    })

    // 清除某设备（或全部）的越狱检测缓存，供 UI 手动重新检测
    safeHandle('clear-jailbreak-cache', async (_event, args: { deviceId?: string }) => {
      clearJailbreakCache(args?.deviceId);
      return true;
    })

    // 用户手动标记设备为已越狱（"我确认已越狱，跳过自动检测"）
    // 可选传入 SSH 密码 / remotePort，供文件管理直接以越狱模式访问根目录
    safeHandle('set-forced-jailbreak', async (_event, args: { deviceId: string; password?: string; remotePort?: number }) => {
      await setForcedJailbreak(args.deviceId, { password: args.password, remotePort: args.remotePort });
      return true;
    })

    // 清除手动越狱标记，恢复自动检测
    safeHandle('unset-forced-jailbreak', async (_event, args: { deviceId: string }) => {
      unsetForcedJailbreak(args.deviceId);
      return true;
    })

    console.log('[IPC] Registered: File System handlers');
  } catch (e) {
    console.error('[IPC] Failed to register File System handlers:', e);
  }

  // 解包会话存储（两阶段重签名用）
  const decompileSessions = new Map<string, DecompileSession>();

  // Signer Handlers
  try {
    safeHandle('signer-get-aliases', async (_event, { path, pass }) => {
      return await getKeystoreAliases(path, pass);
    })

    safeHandle('signer-resign-apk', async (event, args) => {
      return await resignApk({
        ...args,
        onLog: (msg: string) => event.sender.send('signer-log', msg)
      });
    })

    safeHandle('signer-get-ios-identities', async () => {
      console.log('[IPC] signer-get-ios-identities handler called');
      return await getIosIdentities();
    })
    console.log('[IPC] Registered: signer-get-ios-identities');

    safeHandle('signer-resign-ipa', async (event, args) => {
      return await resignIpa({
        ...args,
        onLog: (msg: string) => event.sender.send('signer-log', msg)
      });
    })

    safeHandle('signer-analyze-apk', async (event, args: { apkPath: string; isResigned?: boolean }) => {
      const { analyzeApkSignature } = await import('./services/signerService');
      await analyzeApkSignature(args.apkPath, (msg: string) => {
        event.sender.send('signer-log', msg);
      }, args.isResigned || false);
      return true;
    })

    safeHandle('signer-analyze-ipa', async (event, args: { ipaPath: string; isResigned?: boolean }) => {
      const { analyzeIpaSignature } = await import('./services/signerService');
      await analyzeIpaSignature(args.ipaPath, (msg: string) => {
        event.sender.send('signer-log', msg);
      }, args.isResigned || false);
      return true;
    })

    safeHandle('signer-inject-resign-apk', async (event, args) => {
      return await injectAndResignApk({
        ...args,
        onLog: (msg: string) => event.sender.send('signer-log', msg)
      });
    })

    safeHandle('signer-get-build-tools', async () => {
      console.log('[IPC] signer-get-build-tools handler called');
      const tool = getBuildToolsPath();
      console.log('[IPC] Found build tools at:', tool);
      return tool;
    })
    console.log('[IPC] Registered: signer-get-build-tools');

    // 两阶段重签名：阶段一 - 解包
    safeHandle('signer-decompile-apk', async (event, args: { apkPath: string }) => {
      const session = await decompileApkForEdit({
        apkPath: args.apkPath,
        onLog: (msg: string) => event.sender.send('signer-log', msg)
      });
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      decompileSessions.set(sessionId, session);
      return { sessionId, decodeDir: session.decodeDir };
    });

    // 两阶段重签名：阶段二 - 继续注入 + 打包 + 签名
    safeHandle('signer-continue-resign-apk', async (event, args: {
      sessionId: string;
      keystorePath: string;
      storePass: string;
      keyPass: string;
      alias: string;
    }) => {
      const session = decompileSessions.get(args.sessionId);
      if (!session) return { success: false, message: '会话不存在或已过期，请重新解包' };
      decompileSessions.delete(args.sessionId);
      return await resignFromDecompiled({
        session,
        keystorePath: args.keystorePath,
        storePass: args.storePass,
        keyPass: args.keyPass,
        alias: args.alias,
        onLog: (msg: string) => event.sender.send('signer-log', msg)
      });
    });

    // 取消解包会话（清理临时目录）
    safeHandle('signer-cancel-session', async (_event, args: { sessionId: string }) => {
      const session = decompileSessions.get(args.sessionId);
      if (session) {
        cleanupDecompileSession(session);
        decompileSessions.delete(args.sessionId);
      }
      return true;
    });

    // 在系统文件管理器中打开目录
    safeHandle('signer-open-path', async (_event, args: { dirPath: string }) => {
      const { shell } = await import('electron');
      await shell.openPath(args.dirPath);
      return true;
    });

  } catch (e) {
    console.error('[IPC] Failed to register Signer handlers:', e);
  }

  // Other Handlers

  safeHandle('ios-list-apps', async (_event, args: { deviceId: string }) => {
    return await listIosApps(args.deviceId);
  })

  safeHandle('dialog-select-file', async (_event, options: { title?: string, filters?: { name: string, extensions: string[] }[] }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: options.title,
      filters: options.filters,
      properties: ['openFile']
    });
    if (canceled) return null;
    return filePaths[0];
  })

  safeHandle('dialog-select-directory', async (_event, options: { title?: string }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: options.title,
      properties: ['openDirectory']
    });
    if (canceled) return null;
    return filePaths[0];
  })

  // 简化的选择目录处理器（用于脱壳输出）
  safeHandle('select-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择脱壳文件输出目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled) return null;
    return filePaths[0];
  })

  safeHandle('dialog-prompt', async (_event, options: { title: string, message: string, defaultValue?: string }) => {
    // HTML 转义：防止 title/message/defaultValue（例如重命名时的现有文件名，可能含 " < > 等）
    // 被注入到高权限（nodeIntegration）弹窗 HTML 中造成 XSS/RCE
    const escapeHtml = (s: string) => String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    // 创建一个简单的输入窗口
    const promptWin = new BrowserWindow({
      width: 400,
      height: 200,
      modal: true,
      parent: win || undefined,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            padding: 20px;
            margin: 0;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h3 {
            margin: 0 0 10px 0;
            font-size: 16px;
            color: #333;
          }
          p {
            margin: 0 0 15px 0;
            font-size: 14px;
            color: #666;
          }
          input {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
          }
          .buttons {
            margin-top: 20px;
            text-align: right;
            padding-top: 10px;
          }
          button {
            padding: 8px 16px;
            margin-left: 8px;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
          }
          .cancel {
            background: #e0e0e0;
            color: #333;
          }
          .ok {
            background: #007aff;
            color: white;
          }
          button:hover {
            opacity: 0.9;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h3>${escapeHtml(options.title)}</h3>
          <p>${escapeHtml(options.message)}</p>
          <input type="text" id="input" value="${escapeHtml(options.defaultValue || '')}" autofocus />
          <div class="buttons">
            <button class="cancel" onclick="cancel()">取消</button>
            <button class="ok" onclick="submit()">确定</button>
          </div>
        </div>
        <script>
          const { ipcRenderer } = require('electron');
          const input = document.getElementById('input');
          
          input.focus();
          input.select();
          
          input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') cancel();
          });
          
          function submit() {
            ipcRenderer.send('prompt-response', input.value);
          }
          
          function cancel() {
            ipcRenderer.send('prompt-response', null);
          }
        </script>
      </body>
      </html>
    `;

    promptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    promptWin.show();

    return new Promise((resolve) => {
      ipcMain.once('prompt-response', (_event, value) => {
        promptWin.close();
        resolve(value);
      });
    });
  })
  
  // 用 Node 原生 https/http 替换 Electron net.request，支持超时 / 忽略 SSL / 二进制 body
  safeHandle('http-request', (_event, args: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string                          // 文本 body 或 base64 编码后的二进制
    bodyEncoding?: 'text' | 'base64'       // body 编码方式（默认 text）
    timeout?: number                        // 请求超时（ms，0/未设 = 无超时）
    rejectUnauthorized?: boolean            // false = 忽略 SSL 证书错误
  }) => {
    return new Promise((resolve, reject) => {
      let parsed: NodeURL;
      try { parsed = new NodeURL(args.url); }
      catch (e) { reject(new Error(`Invalid URL: ${(e as Error).message}`)); return; }

      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const bodyBuf = args.body
        ? (args.bodyEncoding === 'base64' ? Buffer.from(args.body, 'base64') : Buffer.from(args.body, 'utf-8'))
        : undefined;

      // 若调用方未显式设置 Content-Length，且有 body，则自动填入（防止 chunked 有些接口不接受）
      const headers = { ...(args.headers || {}) };
      if (bodyBuf && !Object.keys(headers).some(k => k.toLowerCase() === 'content-length')) {
        headers['Content-Length'] = String(bodyBuf.length);
      }

      const req = lib.request({
        method: args.method,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers,
        rejectUnauthorized: args.rejectUnauthorized !== false, // 默认严格；显式 false 才忽略
      }, (res) => {
        const resHeaders: Record<string, string> = {};
        for (const [key, values] of Object.entries(res.headers)) {
          resHeaders[key] = Array.isArray(values) ? values.join(', ') : String(values ?? '');
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: resHeaders,
            body: buf.toString('utf-8'),
            bodyBase64: buf.toString('base64'),  // 供响应保存到文件（二进制安全）
          });
        });
        res.on('error', (err: Error) => reject(err));
      });

      req.on('error', (err: Error) => reject(err));

      if (args.timeout && args.timeout > 0) {
        req.setTimeout(args.timeout, () => {
          req.destroy(new Error(`Request timeout after ${args.timeout}ms`));
        });
      }

      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });
  })

  // 保存响应到本地文件（支持文本或 base64 二进制）
  safeHandle('save-response-to-file', async (_event, args: {
    defaultName?: string
    content: string
    encoding?: 'utf-8' | 'base64'
  }) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '保存响应到文件',
      defaultPath: args.defaultName || `response_${Date.now()}.txt`,
    });
    if (canceled || !filePath) return null;
    const buf = args.encoding === 'base64'
      ? Buffer.from(args.content, 'base64')
      : Buffer.from(args.content, 'utf-8');
    await fs.promises.writeFile(filePath, buf);
    return filePath;
  })

  // 选择要作为 binary body 上传的本地文件
  safeHandle('select-upload-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    const p = filePaths[0];
    const stat = await fs.promises.stat(p);
    return { path: p, name: path.basename(p), size: stat.size };
  })

  // 读取本地文件为 base64（供 binary body 传输）
  safeHandle('read-file-base64', async (_event, args: { path: string }) => {
    const buf = await fs.promises.readFile(args.path);
    return buf.toString('base64');
  })

  console.log('[IPC] All handlers setup complete');
}
