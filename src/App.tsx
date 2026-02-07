import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { LogViewer } from './components/LogViewer';
import { FileManager } from './components/FileManager';
import { AppSigner } from './components/AppSigner';
import { AppDecrypt } from './components/AppDecrypt';
import { Device, LogEntry, FilterState, Theme } from './types';
import { AlertTriangle, X, FilterX, Sun, Moon, Terminal } from 'lucide-react';

// 声明全局 window.ipcRenderer
declare global {
  interface Window {
    ipcRenderer: {
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => () => void;
      off: (channel: string, listener: (...args: any[]) => void) => void;
      send: (channel: string, ...args: any[]) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
    };
  }
}

function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [isLogging, setIsLogging] = useState(false);
  const isLoggingRef = useRef(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [theme, setTheme] = useState<Theme>('dark');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'logs' | 'files' | 'signer' | 'decrypt'>('logs');
  const [isDeviceDropdownOpen, setIsDeviceDropdownOpen] = useState(false);
  
  const [filters, setFilters] = useState<FilterState>({
    level: 'V',
    tag: '',
    pid: '',
    search: ''
  });

  const selectedPlatform = useMemo(() => {
    const device = devices.find(d => d.id === selectedDevice);
    return device?.platform || 'android';
  }, [devices, selectedDevice]);



  // 同步 theme 到 document.documentElement
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // 错误提示自动消失
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 5000); // 5秒后自动消失
      
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (selectedPlatform === 'ios') {
      setFilters(prev => {
        if (prev.level === 'V') {
          return { ...prev, level: 'I' };
        }
        return prev;
      });
    }
  }, [selectedPlatform]);

  // 获取设备列表
  const refreshDevices = useCallback(async () => {
    try {
      const devs = await window.ipcRenderer.invoke('get-devices');
      setDevices(devs);
      // 如果当前选中的设备不在列表中，清空选中
      if (selectedDevice && !devs.find((d: Device) => d.id === selectedDevice)) {
        // 也可以保持选中，显示离线状态
        // setSelectedDevice('');
      }
    } catch (e) {
      // Failed to get devices
    }
  }, [selectedDevice]);

  useEffect(() => {
    refreshDevices();
    // 可选：定时刷新设备列表
    const interval = setInterval(refreshDevices, 5000);
    return () => clearInterval(interval);
  }, [refreshDevices]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = () => {
      if (isDeviceDropdownOpen) {
        setIsDeviceDropdownOpen(false);
      }
    };
    
    if (isDeviceDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isDeviceDropdownOpen]);

  // 监听日志数据
  // 使用 Ref 存储缓冲区，避免频繁 state 更新导致 UI 卡死
  const logBufferRef = useRef<LogEntry[]>([]);

  const handleSelectDevice = (deviceId: string) => {
      // 立即停止当前日志
      if (isLogging) {
        window.ipcRenderer.send('stop-log');
        setIsLogging(false);
        isLoggingRef.current = false;
      }
      
      // 无论之前状态如何，切换设备时立即清空所有日志和缓冲
      // 使用函数式更新确保清空操作不会被合并忽略
      setLogs(() => []);
      logBufferRef.current = [];
      setError(null);
      
      setSelectedDevice(deviceId);
  };

  useEffect(() => {
    // 监听单条日志（旧逻辑，保留以防万一）
    const removeListener = window.ipcRenderer.on('log-data', () => {
       // Legacy single log handler - no longer used
    });
      
      // 监听批量日志
      const removeBatchListener = window.ipcRenderer.on('log-data-batch', (_event, logs: LogEntry[]) => {
        // 关键修复：不要直接 setLogs([...prev, ...logs])，这在短时间内大量触发会导致 React 渲染崩溃（黑屏）
        // 恢复 Ref 缓冲机制，这是处理高频数据的唯一正确方式
        if (!isLoggingRef.current) return;
        if (logs && logs.length > 0) {
             logBufferRef.current.push(...logs);
        }
      });

      // 监听错误
      const removeErrorListener = window.ipcRenderer.on('log-error', (_event, errorMsg: string) => {
          setError(errorMsg);
      });

    // 定时批量更新日志 (每 200ms)
    // 恢复定时器
    const intervalId = setInterval(() => {
      if (logBufferRef.current.length > 0) {
        // 使用 slice 限制单次更新数量，防止一次性渲染太多导致黑屏
        const logsToProcess = logBufferRef.current.splice(0, 2000); 
        
        setLogs(prevLogs => {
          const newLogs = [...prevLogs, ...logsToProcess];
          
          // 限制最大日志条数，防止内存溢出
          // 提升到 1000 条，配合基础渲染
          if (newLogs.length > 1000) {
            return newLogs.slice(newLogs.length - 1000);
          }
          return newLogs;
        });
      }
    }, 200);

    return () => {
        removeListener();
        removeBatchListener();
        removeErrorListener();
        clearInterval(intervalId);
      };
    }, []);

  const handleToggleLogging = () => {
    if (isLogging) {
      window.ipcRenderer.send('stop-log');
      setIsLogging(false);
      isLoggingRef.current = false;
    } else {
      if (!selectedDevice) return;
      const device = devices.find(d => d.id === selectedDevice);
      if (!device) return;

      setError(null); // Clear previous errors
      setLogs([]); // Clear logs on start
      logBufferRef.current = []; // Clear buffer
      
      window.ipcRenderer.send('start-log', {
        platform: device.platform,
        deviceId: device.id
      });
      setIsLogging(true);
      isLoggingRef.current = true;
      setAutoScroll(true);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
    setError(null);
  };

  const filteredLogs = useMemo(() => {
    const { level, tag, pid, search } = filters;
    const normalizedTag = tag.trim();
    const normalizedPid = pid.trim();
    const normalizedSearch = search.trim();
    const levels = ['V', 'D', 'I', 'W', 'E', 'F'];
    const selectedLevel = level.toUpperCase();

    let tagRegex: RegExp | null = null;
    if (normalizedTag) {
      try {
        tagRegex = new RegExp(normalizedTag, 'i');
      } catch (e) {
        // ignore invalid regex
      }
    }

    let searchRegex: RegExp | null = null;
    if (normalizedSearch) {
      try {
        searchRegex = new RegExp(normalizedSearch, 'i');
      } catch (e) {
         // ignore
      }
    }

    return logs.filter(log => {
      // Level filter
      const logLevel = (log.level || '').toUpperCase().trim();
      if (!levels.includes(logLevel)) return false;
      if (selectedLevel !== 'V' && logLevel !== selectedLevel) return false;
      
      // PID filter
      if (normalizedPid && log.pid.toString() !== normalizedPid) return false;

      // Tag filter
      if (tagRegex && !tagRegex.test(log.tag)) return false;
      if (!tagRegex && normalizedTag && !log.tag.toLowerCase().includes(normalizedTag.toLowerCase())) return false;

      // Search filter
      if (searchRegex && !searchRegex.test(log.msg)) return false;
      if (!searchRegex && normalizedSearch && !log.msg.toLowerCase().includes(normalizedSearch.toLowerCase())) return false;

      return true;
    });
  }, [logs, filters, selectedPlatform]);

  return (
    <div className={`flex flex-col h-screen w-screen overflow-hidden ${theme === 'dark' ? 'bg-zinc-950 text-zinc-200' : 'bg-slate-50 text-slate-900'}`}>
      {/* 顶部导航栏 */}
      <header className={`h-14 px-6 border-b flex items-center justify-between shrink-0 z-30 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 shadow-sm' : 'bg-white border-slate-200 shadow-sm'}`}>
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Terminal size={18} className="text-white" />
            </div>
            <span className="font-bold tracking-tight text-base">MKTools</span>
          </div>

          <nav className="flex items-center p-1 gap-1">
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === 'logs' 
                  ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-slate-100 text-slate-900 shadow-sm') 
                  : (theme === 'dark' ? 'text-zinc-500 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-900')
              }`}
            >
              日志
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === 'files' 
                  ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-slate-100 text-slate-900 shadow-sm') 
                  : (theme === 'dark' ? 'text-zinc-500 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-900')
              }`}
            >
              文件管理
            </button>
            <button
              onClick={() => setActiveTab('signer')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === 'signer' 
                  ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-slate-100 text-slate-900 shadow-sm') 
                  : (theme === 'dark' ? 'text-zinc-500 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-900')
              }`}
            >
              应用重签名
            </button>
            <button
              onClick={() => setActiveTab('decrypt')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === 'decrypt' 
                  ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-slate-100 text-slate-900 shadow-sm') 
                  : (theme === 'dark' ? 'text-zinc-500 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-900')
              }`}
            >
              应用脱壳
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${selectedDevice ? 'bg-green-500 animate-pulse' : 'bg-zinc-600'}`} />
            <div className="relative">
              {/* 自定义下拉按钮 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDeviceDropdownOpen(!isDeviceDropdownOpen);
                }}
                className={`pl-9 pr-8 py-1.5 rounded-lg text-xs font-medium border transition-all outline-none focus:ring-2 focus:ring-blue-500/20 ${
                  theme === 'dark' 
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:border-zinc-600' 
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:border-slate-300'
                } min-w-[200px] cursor-pointer text-left`}
              >
                {selectedDevice 
                  ? devices.find(d => d.id === selectedDevice)?.name || '未选择设备'
                  : '未选择设备'
                }
              </button>
              
              {/* 平台图标 */}
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                {selectedDevice ? (
                  selectedPlatform === 'ios' ? (
                    // Apple Logo
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}>
                      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                    </svg>
                  ) : (
                    // Android Logo
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}>
                      <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-2.86-1.21-6.08-1.21-8.94 0L5.65 5.67c-.19-.28-.54-.37-.83-.22-.3.16-.42.54-.26.85l1.84 3.18C4.08 11.36 2.5 14.5 2.5 18h19c0-3.5-1.58-6.64-3.9-8.52zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z"/>
                    </svg>
                  )
                ) : (
                  // Default icon when no device selected
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={theme === 'dark' ? 'text-zinc-600' : 'text-slate-400'}>
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                    <line x1="12" y1="18" x2="12.01" y2="18"></line>
                  </svg>
                )}
              </div>
              
              {/* 下拉箭头 */}
              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg 
                  width="12" 
                  height="12" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  className={`${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'} transition-transform ${isDeviceDropdownOpen ? 'rotate-180' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              
              {/* 下拉菜单 */}
              {isDeviceDropdownOpen && (
                <div 
                  className={`absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-xl z-50 max-h-64 overflow-y-auto ${
                    theme === 'dark'
                      ? 'bg-zinc-800 border-zinc-700'
                      : 'bg-white border-slate-200'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* 未选择设备选项 */}
                  <button
                    onClick={() => {
                      handleSelectDevice('');
                      setIsDeviceDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors ${
                      !selectedDevice
                        ? (theme === 'dark' ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700')
                        : (theme === 'dark' ? 'hover:bg-zinc-700 text-zinc-300' : 'hover:bg-slate-100 text-slate-700')
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                      <line x1="12" y1="18" x2="12.01" y2="18"></line>
                    </svg>
                    <span>未选择设备</span>
                  </button>
                  
                  {/* 设备列表 */}
                  {devices.map(device => (
                    <button
                      key={device.id}
                      onClick={() => {
                        handleSelectDevice(device.id);
                        setIsDeviceDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors ${
                        selectedDevice === device.id
                          ? (theme === 'dark' ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700')
                          : (theme === 'dark' ? 'hover:bg-zinc-700 text-zinc-300' : 'hover:bg-slate-100 text-slate-700')
                      }`}
                    >
                      {device.platform === 'ios' ? (
                        // Apple Logo
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                        </svg>
                      ) : (
                        // Android Logo
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                          <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-2.86-1.21-6.08-1.21-8.94 0L5.65 5.67c-.19-.28-.54-.37-.83-.22-.3.16-.42.54-.26.85l1.84 3.18C4.08 11.36 2.5 14.5 2.5 18h19c0-3.5-1.58-6.64-3.9-8.52zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z"/>
                        </svg>
                      )}
                      <span className="truncate">{device.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={`w-[1px] h-6 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-slate-200'}`} />

          <button
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
              theme === 'dark' 
                ? 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700' 
                : 'bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200'
            }`}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          >
            {theme === 'dark' ? <Moon size={18} className="fill-current" /> : <Sun size={18} className="fill-current" />}
          </button>
        </div>
      </header>

      {/* 主内容区域 */}
      <main className="flex-1 relative overflow-hidden">
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4 animate-in slide-in-from-top-4 fade-in duration-300">
             <div className={`border px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md flex items-center justify-between ${
               theme === 'dark' ? 'bg-red-500/10 border-red-500/20 text-red-200' : 'bg-red-50 border-red-200 text-red-800'
             }`}>
                <div className="flex items-center gap-3">
                    <AlertTriangle size={18} className={theme === 'dark' ? 'text-red-400' : 'text-red-600'} />
                    <span className="font-medium text-sm">{error}</span>
                </div>
                <button 
                    onClick={() => setError(null)} 
                    className={`p-1.5 rounded-lg transition-colors ${
                      theme === 'dark' ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-100'
                    }`}
                >
                    <X size={16} />
                </button>
             </div>
          </div>
        )}

        <div className={activeTab === 'files' ? 'h-full' : 'hidden'}>
          <FileManager
            deviceId={selectedDevice}
            platform={selectedPlatform}
            theme={theme}
            onError={setError}
          />
        </div>
        
        <div className={activeTab === 'signer' ? 'h-full' : 'hidden'}>
          <AppSigner
            theme={theme}
            onError={setError}
          />
        </div>

        <div className={activeTab === 'decrypt' ? 'h-full' : 'hidden'}>
          <AppDecrypt
            theme={theme}
            platform={selectedPlatform}
            deviceId={selectedDevice}
            onError={setError}
          />
        </div>

        <div className={activeTab === 'logs' ? 'flex h-full' : 'hidden'}>
          <Sidebar 
            devices={devices}
            selectedDevice={selectedDevice}
            onSelectDevice={handleSelectDevice}
            isLogging={isLogging}
            onToggleLogging={handleToggleLogging}
            onClearLogs={handleClearLogs}
            filters={filters}
            onFilterChange={setFilters}
            selectedPlatform={selectedPlatform}
            theme={theme}
            onToggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
            showDeviceSelect={false}
            showTitle={false}
            showThemeToggle={false}
          />
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <div className="flex-1 relative">
              {isLogging && logs.length === 0 && !error && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  <div className="flex flex-col items-center gap-3 opacity-40">
                    <div className="w-12 h-12 rounded-full border-4 border-zinc-500/20 border-t-zinc-500 animate-spin" />
                    <div className="text-zinc-500 text-xs font-medium uppercase tracking-widest">Waiting for stream...</div>
                  </div>
                </div>
              )}
              
              {isLogging && logs.length > 0 && filteredLogs.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  <div className={`flex flex-col items-center gap-4 p-8 rounded-2xl border shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${
                    theme === 'dark' ? 'bg-zinc-900/90 border-zinc-800' : 'bg-white/90 border-slate-200'
                  }`}>
                    <div className={`p-4 rounded-full ${theme === 'dark' ? 'bg-zinc-800 text-zinc-500' : 'bg-slate-100 text-slate-400'}`}>
                      <FilterX size={32} strokeWidth={1.5} />
                    </div>
                    <div className="text-center">
                      <h3 className="font-bold text-sm">无匹配结果</h3>
                      <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-500'}`}>请调整过滤条件以查看更多日志</p>
                    </div>
                    <button 
                      onClick={() => setFilters({ level: 'V', tag: '', pid: '', search: '' })}
                      className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all pointer-events-auto active:scale-95"
                    >
                      重置所有过滤器
                    </button>
                  </div>
                </div>
              )}

              <LogViewer 
                key={selectedDevice}
                logs={filteredLogs}
                autoScroll={autoScroll}
                onScroll={(isAtBottom) => {
                  setAutoScroll(isAtBottom);
                }}
                onToggleAutoScroll={() => setAutoScroll(prev => !prev)}
                platform={selectedPlatform}
                theme={theme}
                onClearLogs={handleClearLogs}
                hasSelectedDevice={!!selectedDevice}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
