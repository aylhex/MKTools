import React, { useState, useEffect } from 'react';
import { Theme, SignResult, Device } from '../types';
import { Shield, Smartphone, Apple, FileUp, Key, Activity, Loader2, CheckCircle2, XCircle, X, Download } from 'lucide-react';

interface AppSignerProps {
  theme: Theme;
  onError: (msg: string | null) => void;
}

export const AppSigner: React.FC<AppSignerProps> = ({ theme, onError }) => {
  const [platform, setPlatform] = useState<'android' | 'ios'>('android');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SignResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logContainerRef = React.useRef<HTMLDivElement>(null);

  // Android state
  const [apkPath, setApkPath] = useState('');
  const [keystorePath, setKeystorePath] = useState('');
  const [storePass, setStorePass] = useState('');
  const [keyAlias, setKeyAlias] = useState('');
  const [keyPass, setKeyPass] = useState('');
  const [buildToolsPath, setBuildToolsPath] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [useHook, setUseHook] = useState(false);

  // iOS state
  const [ipaPath, setIpaPath] = useState('');
  const [mobileProvisionPath, setMobileProvisionPath] = useState('');
  const [identity, setIdentity] = useState('');
  const [identities, setIdentities] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);

  const isDark = theme === 'dark';

  useEffect(() => {
    const handleLog = (_event: any, msg: string) => {
      setLogs(prev => [...prev, msg]);
    };
    const unsubscribe = window.ipcRenderer.on('signer-log', handleLog);
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (platform === 'android' && !buildToolsPath) {
      loadBuildToolsPath();
    }
    if (platform === 'ios' && identities.length === 0) {
      loadIosIdentities();
    }
  }, [platform]);

  const loadBuildToolsPath = async () => {
    try {
      const path = await window.ipcRenderer.invoke('signer-get-build-tools');
      if (path) setBuildToolsPath(path);
    } catch (e: any) {
      console.error('Failed to load build-tools path:', e);
    }
  };

  const loadIosIdentities = async () => {
    try {
      const list = await window.ipcRenderer.invoke('signer-get-ios-identities');
      setIdentities(list);
    } catch (e: any) {
      onError(e.message);
    }
  };

  const handleGetAliases = async () => {
    if (!keystorePath || !storePass) {
      onError('请输入 Keystore 路径和密码');
      return;
    }
    setLoading(true);
    try {
      const list = await window.ipcRenderer.invoke('signer-get-aliases', { path: keystorePath, pass: storePass });
      setAliases(list);
      if (list.length > 0) setKeyAlias(list[0]);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async () => {
    if (!result?.outputPath) return;
    
    setInstalling(true);
    try {
      const devices: Device[] = await window.ipcRenderer.invoke('get-devices');
      const targetDevices = devices.filter(d => d.platform === platform);
      
      if (targetDevices.length === 0) {
        throw new Error(`未检测到 ${platform === 'android' ? 'Android' : 'iOS'} 设备，请连接设备后重试`);
      }
      
      const device = targetDevices[0];
      const msg = `正在安装到设备: ${device.name} (${device.id})...`;
      setLogs(prev => [...prev, msg]);
      
      await window.ipcRenderer.invoke('install-app', {
        deviceId: device.id,
        platform,
        filePath: result.outputPath,
        fileType: platform === 'android' ? 'apk' : 'ipa'
      });
      
      setLogs(prev => [...prev, '安装成功!']);
    } catch (e: any) {
      onError(e.message);
      setLogs(prev => [...prev, `安装失败: ${e.message}`]);
    } finally {
      setInstalling(false);
    }
  };

  const handleSign = async () => {
    if (!keystorePath || !storePass || !keyAlias) {
      onError('请输入 Keystore 信息并选择 Alias');
      return;
    }
    
    setLoading(true);
    setResult(null);
    setLogs([]);
    try {
      let res: SignResult;
      if (platform === 'android') {
        if (useHook) {
          res = await window.ipcRenderer.invoke('signer-inject-resign-apk', {
            apkPath, keystorePath, storePass, alias: keyAlias, keyPass, buildToolsPath
          });
        } else {
          res = await window.ipcRenderer.invoke('signer-resign-apk', {
            apkPath, keystorePath, storePass, alias: keyAlias, keyPass, buildToolsPath
          });
        }
      } else {
        res = await window.ipcRenderer.invoke('signer-resign-ipa', {
          ipaPath, mobileProvisionPath, identity
        });
      }
      setResult(res);
      
      // 如果重签名成功，自动分析新文件的签名信息
      if (res.success && res.outputPath) {
        // 添加分隔线
        setLogs(prev => [...prev, '', '══════════════════════════════', '【重签名后的签名信息】', '══════════════════════════════', '']);
        
        // 分析新文件的签名
        if (platform === 'android') {
          try {
            await window.ipcRenderer.invoke('signer-analyze-apk', { apkPath: res.outputPath, isResigned: true });
          } catch (e: any) {
            console.error('Failed to analyze signed APK:', e);
          }
        } else {
          try {
            await window.ipcRenderer.invoke('signer-analyze-ipa', { ipaPath: res.outputPath, isResigned: true });
          } catch (e: any) {
            console.error('Failed to analyze signed IPA:', e);
          }
        }
      } else if (!res.success) {
        onError(res.message);
      }
    } catch (e: any) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-zinc-950 border-zinc-800 text-zinc-200 focus:border-blue-500/50' : 'bg-white border-zinc-200 text-zinc-900 shadow-sm focus:border-blue-500'} focus:outline-none transition-all focus:ring-4 focus:ring-blue-500/10`;
  const labelClass = `block text-[10px] font-bold mb-1.5 uppercase tracking-widest ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`;

  const selectFile = async (title: string, extensions: string[], setter: (val: string) => void, isAppFile: boolean = false) => {
    const path = await window.ipcRenderer.invoke('dialog-select-file', {
      title,
      filters: [{ name: title, extensions }]
    });
    if (path) {
      setter(path);
      
      // 如果是应用文件（APK 或 IPA），自动分析签名信息
      if (isAppFile) {
        // 清空之前的日志
        setLogs([]);
        
        // 根据文件扩展名判断平台
        if (path.toLowerCase().endsWith('.apk')) {
          // 分析 Android APK 签名
          try {
            await window.ipcRenderer.invoke('signer-analyze-apk', { apkPath: path });
          } catch (e: any) {
            console.error('Failed to analyze APK:', e);
          }
        } else if (path.toLowerCase().endsWith('.ipa')) {
          // 分析 iOS IPA 签名
          try {
            await window.ipcRenderer.invoke('signer-analyze-ipa', { ipaPath: path });
          } catch (e: any) {
            console.error('Failed to analyze IPA:', e);
          }
        }
      }
    }
  };

  const selectDirectory = async (title: string, setter: (val: string) => void) => {
    const path = await window.ipcRenderer.invoke('dialog-select-directory', { title });
    if (path) setter(path);
  };

  return (
    <div className={`flex h-full overflow-hidden ${isDark ? 'bg-[#1e1e20]' : 'bg-zinc-50/50'}`}>
      {/* 左侧配置面板 - 宽度保持 w-72 */}
      <div className={`w-72 flex flex-col border-r shrink-0 overflow-y-auto ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
        <div className="p-6 space-y-6">
          <div className={`flex p-1 rounded-xl border ${isDark ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-100/50 border-zinc-200/50'}`}>
            <button
              onClick={() => setPlatform('android')}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${platform === 'android' ? (isDark ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5') : (isDark ? 'text-zinc-500 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-900')}`}
            >
              <Smartphone size={12} />
              ANDROID
            </button>
            <button
              onClick={() => setPlatform('ios')}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${platform === 'ios' ? (isDark ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5') : (isDark ? 'text-zinc-500 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-900')}`}
            >
              <Apple size={12} />
              IOS
            </button>
          </div>

          <div className="space-y-5">
            {platform === 'android' ? (
              <>
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <label className={labelClass}>APK FILE</label>
                      <div className="flex gap-1.5">
                        <input type="text" value={apkPath} onChange={e => setApkPath(e.target.value)} className={inputClass} placeholder="Path to APK" />
                        <button onClick={() => selectFile('选择 APK 文件', ['apk'], setApkPath, true)} className={`p-2 rounded-lg border transition-all ${isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 shadow-sm'}`}>
                          <FileUp size={14} />
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>BUILD-TOOLS</label>
                      <div className="flex gap-1.5">
                        <input type="text" value={buildToolsPath} onChange={e => setBuildToolsPath(e.target.value)} className={inputClass} placeholder="Path to build-tools" />
                        <button onClick={() => selectDirectory('选择 Build-Tools 目录', setBuildToolsPath)} className={`p-2 rounded-lg border transition-all ${isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 shadow-sm'}`}>
                          <FileUp size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <label className={labelClass}>KEYSTORE</label>
                      <div className="flex gap-1.5">
                        <input type="text" value={keystorePath} onChange={e => setKeystorePath(e.target.value)} className={inputClass} placeholder="Path to keystore" />
                        <button onClick={() => selectFile('选择 Keystore 文件', ['keystore', 'jks'], setKeystorePath)} className={`p-2 rounded-lg border transition-all ${isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 shadow-sm'}`}>
                          <FileUp size={14} />
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>STORE PASS</label>
                      <input type="password" value={storePass} onChange={e => setStorePass(e.target.value)} className={inputClass} />
                    </div>
                    <button onClick={handleGetAliases} className={`w-full py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg border transition-all ${isDark ? 'bg-zinc-800 border-zinc-700 text-blue-400 hover:bg-zinc-700' : 'bg-white border-zinc-200 text-blue-600 hover:bg-blue-50 hover:border-blue-200 shadow-sm'}`}>
                      Fetch Aliases
                    </button>
                    <div>
                      <label className={labelClass}>KEY ALIAS</label>
                      <div className="relative">
                        <select value={keyAlias} onChange={e => setKeyAlias(e.target.value)} className={`${inputClass} appearance-none`}>
                          <option value="">Select Alias...</option>
                          {aliases.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                        <div className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>KEY PASS</label>
                      <input type="password" value={keyPass} onChange={e => setKeyPass(e.target.value)} className={inputClass} />
                    </div>
                  </div>
                </div>

                <div 
                  onClick={() => setUseHook(!useHook)}
                  className={`px-3 py-2.5 rounded-xl border cursor-pointer transition-all duration-300 group ${
                    useHook 
                      ? 'border-blue-500/30 bg-blue-500/5 shadow-[0_4px_12px_-4px_rgba(59,130,246,0.3)]' 
                      : `${isDark ? 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700' : 'bg-white border-zinc-200 hover:border-blue-300 hover:shadow-md shadow-sm'}`
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`p-1.5 rounded-lg shrink-0 transition-colors ${useHook ? 'bg-blue-500 text-white' : (isDark ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-100 text-zinc-400')}`}>
                        <Shield size={14} className={useHook ? 'animate-pulse' : ''} />
                      </div>
                      <div className="space-y-0 min-w-0">
                        <h3 className={`text-[10px] font-bold uppercase tracking-wider truncate ${useHook ? (isDark ? 'text-blue-400' : 'text-blue-600') : (isDark ? 'text-zinc-400' : 'text-zinc-600')}`}>
                          Signature Hook
                        </h3>
                        <p className={`text-[9px] font-medium leading-tight truncate ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                          注入代码绕过签名校验
                        </p>
                      </div>
                    </div>
                    <div className={`relative w-9 h-5 rounded-full border shrink-0 transition-all duration-300 ${
                      useHook 
                        ? 'bg-blue-600 border-blue-500 shadow-[0_0_8px_-2px_rgba(59,130,246,0.6)]' 
                        : `${isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-200 border-zinc-300'}`
                    }`}>
                      <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-all duration-300 shadow-sm ${useHook ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <label className={labelClass}>IPA FILE</label>
                      <div className="flex gap-1.5">
                        <input type="text" value={ipaPath} onChange={e => setIpaPath(e.target.value)} className={inputClass} placeholder="Path to IPA" />
                        <button onClick={() => selectFile('选择 IPA 文件', ['ipa'], setIpaPath, true)} className={`p-2 rounded-lg border transition-all ${isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 shadow-sm'}`}>
                          <FileUp size={14} />
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>PROVISION</label>
                      <div className="flex gap-1.5">
                        <input type="text" value={mobileProvisionPath} onChange={e => setMobileProvisionPath(e.target.value)} className={inputClass} placeholder="Path to profile" />
                        <button onClick={() => selectFile('选择描述文件', ['mobileprovision'], setMobileProvisionPath)} className={`p-2 rounded-lg border transition-all ${isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 shadow-sm'}`}>
                          <FileUp size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <label className={labelClass}>CERTIFICATE</label>
                      <div className="relative">
                        <select value={identity} onChange={e => setIdentity(e.target.value)} className={`${inputClass} appearance-none`}>
                          <option value="">Select Identity...</option>
                          {identities.map(id => <option key={id} value={id}>{id}</option>)}
                        </select>
                        <div className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                      </div>
                    </div>
                    <button onClick={loadIosIdentities} className={`text-[10px] font-bold uppercase tracking-widest text-blue-500 hover:text-blue-400 transition-colors`}>
                      Refresh Keychain
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleSign}
            disabled={loading || installing}
            className={`w-full py-3 rounded-xl font-bold uppercase tracking-widest text-xs text-white transition-all flex items-center justify-center gap-2 ${loading ? 'bg-blue-600/50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20 active:scale-[0.98]'}`}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
            {loading ? 'Processing...' : 'Execute Resign'}
          </button>

          <button
            onClick={handleInstall}
            disabled={!result?.success || !result?.outputPath || loading || installing}
            className={`w-full mt-3 py-3 rounded-xl font-bold uppercase tracking-widest text-xs text-white transition-all flex items-center justify-center gap-2 ${(!result?.success || !result?.outputPath || loading || installing) ? `${isDark ? 'bg-zinc-800 text-zinc-600' : 'bg-zinc-200 text-zinc-400'} cursor-not-allowed` : 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/20 active:scale-[0.98]'}`}
          >
            {installing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {installing ? 'Installing...' : 'Install App'}
          </button>
        </div>
      </div>

      {/* 右侧输出面板 - 尺寸与日志输出模块一致 */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* 顶部工具栏 - OPERATION STATUS */}
        <div className={`h-10 px-4 flex items-center justify-between border-b shrink-0 ${isDark ? 'bg-[#252529] border-zinc-700/50 text-zinc-400' : 'bg-[#e2e8f0] border-slate-300 text-slate-700'}`}>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider">
            <Activity size={12} className={loading ? 'text-blue-500 animate-pulse' : ''} />
            {loading ? 'TASK IN PROGRESS' : 'OPERATION STATUS'}
          </div>
        </div>

        {/* 中间日志区域 */}
        <div className="flex-1 overflow-hidden relative flex flex-col">
          {!loading && logs.length === 0 && !result ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center space-y-5 opacity-30">
              <div className={`p-6 rounded-2xl ${isDark ? 'bg-[#252529]' : 'bg-white border border-zinc-100 shadow-sm'}`}>
                <Shield size={40} strokeWidth={1} />
              </div>
              <div className="space-y-1">
                <p className={`text-[10px] font-bold uppercase tracking-[0.3em] ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>System Ready</p>
                <p className={`text-[10px] font-medium ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>Waiting for configuration...</p>
              </div>
            </div>
          ) : (
            <div 
              ref={logContainerRef}
              className={`absolute inset-0 p-4 font-mono text-[11px] overflow-y-auto leading-relaxed scroll-smooth ${
                isDark ? 'bg-[#1e1e20] text-zinc-400' : 'bg-zinc-50/30 text-zinc-600'
              }`}
            >
              {logs.map((log, i) => (
                <div key={i} className="mb-1 whitespace-pre-wrap break-all">
                  <span className="opacity-30 mr-2">[{i + 1}]</span>
                  <span className={log.startsWith('>') ? 'text-blue-500' : ''}>{log}</span>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 mt-2 text-blue-500 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span>Waiting for output...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部结果状态栏 - 仅在有结果时显示 */}
        {result && (
          <div className={`shrink-0 p-3 border-t animate-in slide-in-from-bottom-2 fade-in duration-300 ${
            result.success 
              ? (isDark ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-white border-green-200 text-green-700 shadow-[0_-4px_20px_-4px_rgba(0,0,0,0.05)]')
              : (isDark ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-white border-red-200 text-red-700 shadow-[0_-4px_20px_-4px_rgba(0,0,0,0.05)]')
          }`}>
            <div className="flex items-center gap-3">
               <div className={`p-1.5 rounded-full shrink-0 ${result.success ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                 {result.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
               </div>
               <div className="flex-1 min-w-0">
                 <div className="flex items-center justify-between">
                   <h3 className="text-xs font-bold uppercase tracking-wider">
                     {result.success ? 'Sign Success' : 'Sign Failed'}
                   </h3>
                 </div>
                 <p className="text-[10px] font-mono opacity-80 truncate mt-0.5" title={result.success ? result.outputPath : result.message}>
                   {result.success ? result.outputPath : result.message}
                 </p>
               </div>
               <button 
                 onClick={() => setResult(null)}
                 className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                   isDark 
                     ? 'hover:bg-white/10 text-zinc-400 hover:text-zinc-200' 
                     : 'hover:bg-black/5 text-slate-400 hover:text-slate-600'
                 }`}
               >
                 <X size={14} />
               </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
