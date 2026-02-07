import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import path from 'node:path'
import { fixPath } from './utils/env'
import { getDevices, getAndroidApps, getAndroidAppIcon } from './services/deviceService'
import { startLogging, stopLogging } from './services/logService'
import { listDirectory, downloadFile, downloadFileToTemp, deleteTarget, mkdir, upload, listIosApps, renameFile, createFile, checkJailbreak, getIosAppIcon } from './services/fileService'
import { getKeystoreAliases, analyzeApk, resignApk, getIosIdentities, resignIpa, injectAndResignApk } from './services/signerService'
import { installApp, installAppFromDevice } from './services/installService'
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
fixPath();

// 设置 About 面板信息（macOS）
if (process.platform === 'darwin') {
  // 根据是否打包选择图标路径
  const iconPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'app.asar', 'dist', 'icon.png')
    : path.join(__dirname, '../public/icon.png');
    
  app.setAboutPanelOptions({
    applicationName: 'MKTools',
    applicationVersion: '1.0.0',
    version: '1.0.0',
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
  // Cleanup if needed
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  console.log('[Main] App is ready');
  
  // 再次强制设置应用名称（确保在 ready 后生效）
  app.setName('MKTools');
  
  // 在 macOS 上设置 Dock 图标
  if (process.platform === 'darwin' && process.env.VITE_PUBLIC) {
    const iconPath = path.join(process.env.VITE_PUBLIC, 'icon.png')
    if (app.dock) {
      app.dock.setIcon(iconPath)
    }
  }
  
  // 设置应用菜单（确保显示正确的应用名称）
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

  try {
    ipcMain.handle('get-devices', async () => {
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

  ipcMain.handle('get-installed-apps', async (_event, args: { deviceId: string; platform: 'android' | 'ios' }) => {
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

    ipcMain.handle('get-app-icon', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; packageName: string }) => {
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

    ipcMain.handle('decrypt-app', async (event, args: { deviceId: string; platform: 'android' | 'ios'; bundleId: string; outputDir?: string }) => {
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

    ipcMain.handle('extract-ios-headers', async (event, args: { ipaPath: string }) => {
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

    ipcMain.handle('fetch-frida-app-list', async (event, args: { deviceId: string; platform: 'android' | 'ios' }) => {
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
    ipcMain.handle('save-icon-to-cache', async (_event, args: { deviceId: string; platform: string; packageName: string; icon: string }) => {
      try {
        await saveIconToCache(args.deviceId, args.platform, args.packageName, args.icon);
        return true;
      } catch (e: any) {
        console.error('[IPC] save-icon-to-cache failed:', e);
        return false;
      }
    })
    
    ipcMain.handle('get-icon-from-cache', async (_event, args: { deviceId: string; platform: string; packageName: string }) => {
      try {
        return await getIconFromCache(args.deviceId, args.platform, args.packageName);
      } catch (e: any) {
        console.error('[IPC] get-icon-from-cache failed:', e);
        return null;
      }
    })
    
    ipcMain.handle('get-icons-from-cache', async (_event, args: { deviceId: string; platform: string; packageNames: string[] }) => {
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
    
    ipcMain.handle('clear-icon-cache', async () => {
      try {
        await clearIconCache();
        return true;
      } catch (e: any) {
        console.error('[IPC] clear-icon-cache failed:', e);
        return false;
      }
    })
    
    ipcMain.handle('get-cache-stats', async () => {
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
    ipcMain.handle('fs-list', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; path: string, bundleId?: string, skipSymlinkResolution?: boolean }) => {
      return await listDirectory(args, args.skipSymlinkResolution || false);
    })

    ipcMain.handle('fs-download', async (event, args: { deviceId: string; platform: 'android' | 'ios'; remotePath: string, bundleId?: string }) => {
      const result = await downloadFile(args, (percent) => {
        event.sender.send('download-progress', { percent, completed: percent === 100 });
      });
      return result;
    })

    ipcMain.handle('fs-download-temp', async (event, args: { deviceId: string; platform: 'android' | 'ios'; remotePath: string, bundleId?: string }) => {
      const result = await downloadFileToTemp(args, (percent) => {
        event.sender.send('download-progress', { percent, completed: percent === 100 });
      });
      return result;
    })

    ipcMain.handle('install-app', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; filePath: string; fileType: 'apk' | 'ipa' }) => {
      await installApp(args.deviceId, args.platform, args.filePath, args.fileType);
      return true;
    })

    ipcMain.handle('install-app-from-device', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; devicePath: string; fileType: 'apk' | 'ipa' }) => {
      await installAppFromDevice(args.deviceId, args.platform, args.devicePath, args.fileType);
      return true;
    })

    ipcMain.handle('select-local-file', async (_event, args: { filters: { name: string; extensions: string[] }[] }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: args.filters
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      
      return result.filePaths[0];
    })

    ipcMain.handle('fs-delete', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; targetPath: string, bundleId?: string }) => {
      await deleteTarget(args);
      return true;
    })

    ipcMain.handle('fs-mkdir', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; dirPath: string, bundleId?: string }) => {
      await mkdir(args);
      return true;
    })

    ipcMain.handle('fs-rename', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; oldPath: string; newPath: string; bundleId?: string }) => {
      await renameFile(args);
      return true;
    })

    ipcMain.handle('fs-create-file', async (_event, args: { deviceId: string; platform: 'android' | 'ios'; filePath: string; bundleId?: string }) => {
      await createFile(args);
      return true;
    })

    ipcMain.handle('fs-upload', async (event, args: { deviceId: string; platform: 'android' | 'ios'; destPath: string, bundleId?: string }) => {
      return await upload(args, (current, total, fileName) => {
        const percent = Math.round((current / total) * 100);
        event.sender.send('upload-progress', { current, total, percent, fileName });
      });
    })

    ipcMain.handle('check-jailbreak', async (_event, args: { deviceId: string }) => {
      return await checkJailbreak(args.deviceId);
    })
    console.log('[IPC] Registered: File System handlers');
  } catch (e) {
    console.error('[IPC] Failed to register File System handlers:', e);
  }

  // Signer Handlers
  try {
    ipcMain.handle('signer-get-aliases', async (_event, { path, pass }) => {
      return await getKeystoreAliases(path, pass);
    })

    ipcMain.handle('signer-resign-apk', async (event, args) => {
      return await resignApk({
        ...args,
        onLog: (msg: string) => event.sender.send('signer-log', msg)
      });
    })

    ipcMain.handle('signer-get-ios-identities', async () => {
      console.log('[IPC] signer-get-ios-identities handler called');
      return await getIosIdentities();
    })
    console.log('[IPC] Registered: signer-get-ios-identities');

    ipcMain.handle('signer-resign-ipa', async (event, args) => {
      return await resignIpa({
        ...args,
        onLog: (msg: string) => event.sender.send('signer-log', msg)
      });
    })

    ipcMain.handle('signer-analyze-apk', async (event, args: { apkPath: string; isResigned?: boolean }) => {
      const { analyzeApkSignature } = await import('./services/signerService');
      await analyzeApkSignature(args.apkPath, (msg: string) => {
        event.sender.send('signer-log', msg);
      }, args.isResigned || false);
      return true;
    })

    ipcMain.handle('signer-analyze-ipa', async (event, args: { ipaPath: string; isResigned?: boolean }) => {
      const { analyzeIpaSignature } = await import('./services/signerService');
      await analyzeIpaSignature(args.ipaPath, (msg: string) => {
        event.sender.send('signer-log', msg);
      }, args.isResigned || false);
      return true;
    })

    ipcMain.handle('signer-inject-resign-apk', async (event, args) => {
      return await injectAndResignApk({
        ...args,
        onLog: (msg: string) => event.sender.send('signer-log', msg)
      });
    })

    ipcMain.handle('signer-get-build-tools', async () => {
      console.log('[IPC] signer-get-build-tools handler called');
      const tool = getBuildToolsPath();
      console.log('[IPC] Found build tools at:', tool);
      return tool;
    })
    console.log('[IPC] Registered: signer-get-build-tools');
  } catch (e) {
    console.error('[IPC] Failed to register Signer handlers:', e);
  }

  // Other Handlers

  ipcMain.handle('ios-list-apps', async (_event, args: { deviceId: string }) => {
    return await listIosApps(args.deviceId);
  })

  ipcMain.handle('dialog-select-file', async (_event, options: { title?: string, filters?: { name: string, extensions: string[] }[] }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: options.title,
      filters: options.filters,
      properties: ['openFile']
    });
    if (canceled) return null;
    return filePaths[0];
  })

  ipcMain.handle('dialog-select-directory', async (_event, options: { title?: string }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: options.title,
      properties: ['openDirectory']
    });
    if (canceled) return null;
    return filePaths[0];
  })

  // 简化的选择目录处理器（用于脱壳输出）
  ipcMain.handle('select-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择脱壳文件输出目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled) return null;
    return filePaths[0];
  })

  ipcMain.handle('dialog-prompt', async (_event, options: { title: string, message: string, defaultValue?: string }) => {
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
          <h3>${options.title}</h3>
          <p>${options.message}</p>
          <input type="text" id="input" value="${options.defaultValue || ''}" autofocus />
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
  
  console.log('[IPC] All handlers setup complete');
}
