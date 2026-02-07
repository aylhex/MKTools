import React, { useState, useEffect, useRef } from 'react';
import { Theme, AppInfo, Device } from '../types';
import { Terminal, Download, X, Box, AlertTriangle } from 'lucide-react';

interface AppDecryptProps {
  theme: Theme;
  platform?: 'android' | 'ios';
  deviceId?: string;
  onError: (msg: string | null) => void;
}

export const AppDecrypt: React.FC<AppDecryptProps> = ({ theme, platform: initialPlatform = 'android', deviceId, onError }) => {
  const [platform, setPlatform] = useState<'android' | 'ios'>(initialPlatform);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isFetchingApps, setIsFetchingApps] = useState(false);
  const [fridaStatus, setFridaStatus] = useState<'unknown' | 'checking' | 'ready' | 'error'>('unknown');
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [selectedApp, setSelectedApp] = useState<AppInfo | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [outputPath, setOutputPath] = useState<string>(''); // 自定义输出路径
  const logContainerRef = useRef<HTMLDivElement>(null);

  const isDark = theme === 'dark';

  // Sync platform with prop
  useEffect(() => {
    setPlatform(initialPlatform);
  }, [initialPlatform]);

  // Fetch apps
  useEffect(() => {
    const fetchApps = async () => {
      if (!deviceId) {
        setApps([]);
        setFridaStatus('unknown');
        return;
      }
      
      setIsFetchingApps(true);
      setFridaStatus('checking');
      
      try {
        // First, try to get apps via Frida (includes names and icons)
        console.log(`[Info] 开始获取应用列表 - 设备: ${deviceId}, 平台: ${initialPlatform}`);
        
        let fridaApps: any[] = [];
        let fridaSuccess = false;
        
        try {
          console.log('[Info] 尝试通过 Frida 获取应用列表...');
          fridaApps = await window.ipcRenderer.invoke('fetch-frida-app-list', {
            deviceId,
            platform: initialPlatform
          });
          
          console.log('[Debug] Frida 返回数据:', fridaApps);
          
          if (fridaApps && fridaApps.length > 0) {
            console.log(`[✓] Frida 返回 ${fridaApps.length} 个应用`);
            
            // 检查第一个应用的数据结构
            if (fridaApps[0]) {
              console.log('[Debug] 第一个应用示例:', {
                id: fridaApps[0].id,
                name: fridaApps[0].name,
                version: fridaApps[0].version,
                hasIcon: !!fridaApps[0].icon,
                iconLength: fridaApps[0].icon?.length || 0
              });
            }
            
            fridaSuccess = true;
            setFridaStatus('ready');
            
            // Map Frida apps to AppInfo
            const mappedApps: AppInfo[] = fridaApps.map((app: any) => {
              const mapped = {
                packageName: app.id,
                name: app.name || app.id,
                version: app.version || '',
                icon: app.icon || undefined
              };
              
              // 调试：检查映射后的数据
              if (!mapped.name || mapped.name === mapped.packageName) {
                console.warn('[Warn] 应用名称缺失或等于包名:', mapped.packageName);
              }
              if (!mapped.icon) {
                console.warn('[Warn] 应用图标缺失:', mapped.packageName);
              }
              
              return mapped;
            });
            
            console.log(`[✓] 映射完成，共 ${mappedApps.length} 个应用`);
            setApps(mappedApps);
            
            // 加载图标（即使 Frida 成功，frida-ps 也不返回图标）
            loadIcons(mappedApps, deviceId, initialPlatform);
            
            setIsFetchingApps(false);
            return; // Success, no need to fallback
          } else {
            console.warn('[Warn] Frida 返回空数组或无效数据');
          }
        } catch (e) {
          console.error('[Error] Frida 获取失败:', e);
          setFridaStatus('error');
        }
        
        // Fallback: Get basic app list without Frida
        console.log('[Info] 使用基础方法获取应用列表...');
        const result = await window.ipcRenderer.invoke('get-installed-apps', { 
          deviceId, 
          platform: initialPlatform 
        });
        
        console.log('[Debug] 基础方法返回:', result);
        
        const mappedApps: AppInfo[] = result.map((app: any) => ({
          packageName: app.bundleId,
          name: app.name || app.bundleId,
          version: '', 
          icon: undefined
        }));
        
        console.log(`[✓] 基础方法映射完成，共 ${mappedApps.length} 个应用`);
        setApps(mappedApps);
        
        // Try to load icons separately if Frida failed
        if (!fridaSuccess) {
          loadIcons(mappedApps, deviceId, initialPlatform);
        }
        
      } catch (e: any) {
        console.error('Failed to fetch apps:', e);
        onError(`获取应用列表失败: ${e.message}`);
        setApps([]);
        setFridaStatus('error');
      } finally {
        setIsFetchingApps(false);
      }
    };

    fetchApps();
  }, [deviceId, initialPlatform, onError]);

  const loadIcons = async (currentApps: AppInfo[], currentDeviceId: string, currentPlatform: string) => {
     console.log('[Info] Loading icons from cache and device...');
     
     // 1. 先尝试从缓存加载所有图标
     try {
       const packageNames = currentApps.map(app => app.packageName);
       const cachedIcons = await window.ipcRenderer.invoke('get-icons-from-cache', {
         deviceId: currentDeviceId,
         platform: currentPlatform,
         packageNames
       });
       
       if (cachedIcons && Object.keys(cachedIcons).length > 0) {
         console.log(`[Cache] Loaded ${Object.keys(cachedIcons).length} icons from cache`);
         setApps(prev => prev.map(app => ({
           ...app,
           icon: cachedIcons[app.packageName] || app.icon
         })));
       }
     } catch (e) {
       console.warn('[Cache] Failed to load from cache:', e);
     }
     
     // 2. 对于没有缓存的图标，从设备加载
     // 需要重新获取当前状态，因为缓存可能已经更新了一些图标
     await new Promise(resolve => setTimeout(resolve, 100)); // 等待状态更新
     
     setApps(prev => {
       const appsWithoutIcons = prev.filter(app => !app.icon);
       
       if (appsWithoutIcons.length === 0) {
         console.log('[Info] All icons loaded from cache');
         return prev;
       }
       
       console.log(`[Info] Loading ${appsWithoutIcons.length} icons from device...`);
       
       // 异步加载图标
       (async () => {
         // Process in chunks of 3 to avoid overwhelming the IPC/Device
         const CHUNK_SIZE = 3;
         for (let i = 0; i < appsWithoutIcons.length; i += CHUNK_SIZE) {
            const chunk = appsWithoutIcons.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (app) => {
               try {
                  const iconBase64 = await window.ipcRenderer.invoke('get-app-icon', {
                     deviceId: currentDeviceId,
                     platform: currentPlatform,
                     packageName: app.packageName
                  });
                  if (iconBase64) {
                     setApps(prev => prev.map(p => 
                        p.packageName === app.packageName ? { ...p, icon: iconBase64 } : p
                     ));
                     
                     // 保存到缓存
                     window.ipcRenderer.invoke('save-icon-to-cache', {
                       deviceId: currentDeviceId,
                       platform: currentPlatform,
                       packageName: app.packageName,
                       icon: iconBase64
                     }).catch(e => console.warn('Failed to cache icon:', e));
                  }
               } catch (e) {
                  // Ignore icon fetch errors
                  console.warn(`Failed to load icon for ${app.packageName}:`, e);
               }
            }));
            
            // Small delay between chunks
            await new Promise(r => setTimeout(r, 100));
         }
       })();
       
       return prev;
     });
  };

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Listen for decrypt logs
  useEffect(() => {
    const cleanup = window.ipcRenderer.on('decrypt-log', (_event: any, msg: string) => {
      setLogs(prev => [...prev, msg]);
    });
    return cleanup;
  }, []);

  const handleAppClick = (app: AppInfo) => {
    setSelectedApp(app);
    setShowModal(true);
  };

  const handleRefresh = async () => {
    if (!deviceId || isFetchingApps) return;
    
    console.log('[Info] 手动刷新应用列表');
    setIsFetchingApps(true);
    setFridaStatus('checking');
    
    try {
      // 清空当前列表
      setApps([]);
      
      // 重新获取
      const fridaApps = await window.ipcRenderer.invoke('fetch-frida-app-list', {
        deviceId,
        platform: initialPlatform
      });
      
      if (fridaApps && fridaApps.length > 0) {
        const mappedApps: AppInfo[] = fridaApps.map((app: any) => ({
          packageName: app.id,
          name: app.name || app.id,
          version: app.version || '',
          icon: app.icon || undefined
        }));
        
        setApps(mappedApps);
        setFridaStatus('ready');
        loadIcons(mappedApps, deviceId, initialPlatform);
      }
    } catch (e: any) {
      console.error('[Error] 刷新失败:', e);
      onError(`刷新失败: ${e.message}`);
    } finally {
      setIsFetchingApps(false);
    }
  };

  const handleSelectOutputPath = async () => {
    try {
      const result = await window.ipcRenderer.invoke('select-directory');
      if (result) {
        setOutputPath(result);
        console.log('[Info] 选择输出路径:', result);
      }
    } catch (e: any) {
      console.error('[Error] 选择路径失败:', e);
      onError(`选择路径失败: ${e.message}`);
    }
  };

  const handleDecrypt = async () => {
    if (!selectedApp || !deviceId) return;
    
    // 检查 Frida 状态
    if (fridaStatus !== 'ready') {
      onError('Frida 未就绪，无法进行脱壳操作');
      return;
    }
    
    setShowModal(false);
    setLogs([]); // Clear previous logs
    setIsDecrypting(true);

    try {
      const result = await window.ipcRenderer.invoke('decrypt-app', {
        deviceId,
        platform: initialPlatform,
        bundleId: selectedApp.packageName,
        outputDir: outputPath || undefined // 使用自定义路径或默认路径
      });
      
      setLogs(prev => [...prev, `[✓] 脱壳完成！`]);
      setLogs(prev => [...prev, `[✓] 输出文件: ${result}`]);
      
      // 如果是 iOS 平台，询问是否提取 header 文件
      if (initialPlatform === 'ios') {
        const extractHeaders = await new Promise<boolean>((resolve) => {
          // 使用 Electron 的对话框
          const response = window.confirm('脱壳成功！是否提取 header 文件？\n\n将使用 dsdump 工具提取 Objective-C 和 Swift 类信息。');
          resolve(response);
        });
        
        if (extractHeaders) {
          setLogs(prev => [...prev, `[Info] 开始提取 header 文件...`]);
          try {
            const headersDir = await window.ipcRenderer.invoke('extract-ios-headers', {
              ipaPath: result
            });
            setLogs(prev => [...prev, `[✓] Header 文件提取完成！`]);
            setLogs(prev => [...prev, `[✓] Headers 目录: ${headersDir}`]);
          } catch (headerError: any) {
            setLogs(prev => [...prev, `[Error] Header 提取失败: ${headerError.message}`]);
          }
        }
      }
    } catch (e: any) {
      setLogs(prev => [...prev, `[Error] ${e.message}`]);
      onError(e.message);
    } finally {
      setIsDecrypting(false);
    }
  };

  const inputClass = `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-zinc-950 border-zinc-800 text-zinc-200 focus:border-blue-500/50' : 'bg-white border-zinc-200 text-zinc-900 shadow-sm focus:border-blue-500'} focus:outline-none transition-all focus:ring-4 focus:ring-blue-500/10`;

  return (
    <div className={`flex h-full overflow-hidden ${isDark ? 'bg-[#1e1e20]' : 'bg-zinc-50/50'}`}>
      {/* Left Panel - App List */}
      <div className={`w-72 flex flex-col border-r shrink-0 overflow-hidden ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
        {/* Device Status Bar */}
        <div className={`h-12 border-b flex items-center px-4 justify-between shrink-0 ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
          {/* Left: Device Status */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {deviceId ? (
              <>
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  fridaStatus === 'ready' ? 'bg-green-500 animate-pulse' :
                  fridaStatus === 'checking' ? 'bg-blue-500 animate-pulse' :
                  fridaStatus === 'error' ? 'bg-yellow-500' :
                  'bg-zinc-500'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-medium truncate ${isDark ? 'text-zinc-200' : 'text-zinc-900'}`}>
                    {platform === 'android' ? 'Android' : 'iOS'} 设备
                  </div>
                  <div className={`text-[10px] truncate ${
                    fridaStatus === 'ready' ? 'text-green-500' :
                    fridaStatus === 'checking' ? 'text-blue-500' :
                    fridaStatus === 'error' ? 'text-yellow-500' :
                    isDark ? 'text-zinc-500' : 'text-zinc-400'
                  }`}>
                    {fridaStatus === 'ready' ? 'Frida 已就绪' :
                     fridaStatus === 'checking' ? '检查中...' :
                     fridaStatus === 'error' ? 'Frida 未就绪' :
                     '状态未知'}
                  </div>
                </div>
              </>
            ) : (
              <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>未选择设备</span>
            )}
          </div>
          
          {/* Right: Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={!deviceId || isFetchingApps}
            className={`p-2 rounded-lg transition-all shrink-0 ${
              !deviceId || isFetchingApps
                ? 'opacity-50 cursor-not-allowed'
                : isDark
                ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700'
            }`}
            title={isFetchingApps ? '刷新中...' : '刷新列表'}
          >
            <svg className={`w-4 h-4 ${isFetchingApps ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* App List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isFetchingApps ? (
            <div className={`h-full flex flex-col items-center justify-center gap-3 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              <div className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              <span className="text-xs">加载中...</span>
            </div>
          ) : (
            <>
              {apps.map((app, index) => (
                <button
                  key={app.packageName}
                  onClick={() => handleAppClick(app)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all group ${
                    isDark 
                      ? `${index % 2 === 0 ? 'bg-zinc-900/30' : 'bg-zinc-900/60'} hover:bg-zinc-800/70 text-zinc-300 hover:text-zinc-100` 
                      : `${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100 text-slate-600 hover:text-slate-900`
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 overflow-hidden ${isDark ? 'bg-zinc-800 text-zinc-500' : 'bg-slate-100 text-slate-400'}`}>
                    {app.icon ? (
                      <img src={`data:image/png;base64,${app.icon}`} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Box size={20} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{app.name}</div>
                    <div className="text-[10px] opacity-60 truncate">{app.packageName}</div>
                  </div>
                </button>
              ))}
              
              {apps.length === 0 && (
                <div className={`p-8 text-center text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {deviceId ? '未找到应用' : '请选择设备'}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right Panel - Logs */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className={`h-10 border-b flex items-center px-4 justify-between shrink-0 ${isDark ? 'bg-[#252529] border-zinc-700/50' : 'bg-[#e2e8f0] border-slate-300'}`}>
          <div className="flex items-center gap-2">
            <Terminal size={12} className={isDark ? 'text-zinc-400' : 'text-slate-700'} />
            <span className={`text-[11px] font-medium uppercase tracking-wider ${isDark ? 'text-zinc-400' : 'text-slate-700'}`}>
              Console Output
            </span>
          </div>
          <button
            onClick={() => setLogs([])}
            className={`text-[10px] px-2 py-1 rounded border transition-colors ${
              isDark 
                ? 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' 
                : 'border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            CLEAR
          </button>
        </div>
        
        <div 
          ref={logContainerRef}
          className={`flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1 ${isDark ? 'bg-[#1e1e20] text-zinc-300' : 'bg-zinc-50 text-zinc-700'}`}
        >
          {logs.length === 0 ? (
            <div className={`h-full flex flex-col items-center justify-center opacity-30 gap-2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              <Terminal size={32} />
              <span>Ready to decrypt</span>
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="break-all whitespace-pre-wrap border-l-2 border-blue-500/20 pl-3 py-0.5">
                <span className="opacity-40 mr-2 select-none">[{new Date().toLocaleTimeString()}]</span>
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Decrypt Modal */}
      {showModal && selectedApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className={`w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-zinc-200'}`}>
            <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'border-zinc-800' : 'border-zinc-100'}`}>
              <h3 className={`font-bold ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>Decrypt Application</h3>
              <button 
                onClick={() => setShowModal(false)}
                className={`p-1 rounded-lg transition-colors ${isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'}`}
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-4">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden ${isDark ? 'bg-zinc-800 text-zinc-500' : 'bg-slate-100 text-slate-400'}`}>
                  {selectedApp.icon ? (
                    <img src={`data:image/png;base64,${selectedApp.icon}`} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Box size={32} />
                  )}
                </div>
                <div>
                  <h4 className={`font-bold text-lg ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>{selectedApp.name}</h4>
                  <p className={`text-xs font-mono ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>{selectedApp.packageName}</p>
                  {selectedApp.version && (
                    <p className={`text-xs mt-1 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>版本: {selectedApp.version}</p>
                  )}
                </div>
              </div>

              {/* Frida Status Warning */}
              {fridaStatus !== 'ready' && (
                <div className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                  isDark ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                }`}>
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold mb-1">Frida 未就绪</div>
                    <div className="opacity-80">
                      {fridaStatus === 'checking' ? '正在检查 Frida 服务...' : 
                       fridaStatus === 'error' ? 'Frida 服务连接失败，脱壳功能可能无法使用' :
                       '未检测到 Frida 服务'}
                    </div>
                  </div>
                </div>
              )}

              <div className={`p-4 rounded-xl text-sm space-y-2 ${isDark ? 'bg-zinc-950/50 border border-zinc-800' : 'bg-slate-50 border border-slate-200'}`}>
                <div className="flex justify-between">
                  <span className={isDark ? 'text-zinc-500' : 'text-zinc-500'}>脱壳方法</span>
                  <span className={`font-medium ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Frida 注入</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDark ? 'text-zinc-500' : 'text-zinc-500'}>输出格式</span>
                  <span className={`font-medium ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>{platform === 'ios' ? 'IPA' : 'APK'}</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDark ? 'text-zinc-500' : 'text-zinc-500'}>Frida 状态</span>
                  <span className={`font-medium flex items-center gap-1.5 ${
                    fridaStatus === 'ready' ? 'text-green-500' :
                    fridaStatus === 'checking' ? 'text-blue-500' :
                    'text-yellow-500'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      fridaStatus === 'ready' ? 'bg-green-500' :
                      fridaStatus === 'checking' ? 'bg-blue-500 animate-pulse' :
                      'bg-yellow-500'
                    }`} />
                    {fridaStatus === 'ready' ? '已就绪' :
                     fridaStatus === 'checking' ? '检查中...' :
                     '未就绪'}
                  </span>
                </div>
              </div>

              {/* Output Path Selection */}
              <div className="space-y-2">
                <label className={`text-xs font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                  输出路径 (可选)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={outputPath}
                    readOnly
                    placeholder="默认临时目录"
                    className={`flex-1 px-3 py-2 text-xs rounded-lg border ${isDark ? 'bg-zinc-950 border-zinc-800 text-zinc-300 placeholder-zinc-600' : 'bg-white border-zinc-200 text-zinc-700 placeholder-zinc-400'} focus:outline-none`}
                  />
                  <button
                    onClick={handleSelectOutputPath}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      isDark
                        ? 'bg-zinc-800 hover:bg-zinc-750 text-zinc-200'
                        : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
                    }`}
                  >
                    选择
                  </button>
                </div>
                {outputPath && (
                  <button
                    onClick={() => setOutputPath('')}
                    className={`text-xs ${isDark ? 'text-zinc-500 hover:text-zinc-400' : 'text-zinc-500 hover:text-zinc-600'}`}
                  >
                    清除（使用默认路径）
                  </button>
                )}
              </div>
              
              <button
                onClick={handleDecrypt}
                disabled={isDecrypting || fridaStatus !== 'ready'}
                className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                  isDecrypting || fridaStatus !== 'ready'
                    ? 'bg-blue-600/50 cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/20'
                } text-white`}
              >
                {isDecrypting ? (
                  <>处理中...</>
                ) : (
                  <>
                    <Download size={18} />
                    开始脱壳
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
