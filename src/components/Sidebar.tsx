import React from 'react';
import { Device, FilterState, Theme } from '../types';
import { Play, Square, Smartphone, Trash2, Search, Hash, Tag, Filter, Apple, Smartphone as AndroidIcon, Sun, Moon, ChevronLeft, ChevronRight, Terminal, Activity } from 'lucide-react';

interface SidebarProps {
  devices: Device[];
  selectedDevice: string;
  onSelectDevice: (deviceId: string) => void;
  isLogging: boolean;
  onToggleLogging: () => void;
  onClearLogs: () => void;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  selectedPlatform?: 'android' | 'ios';
  theme: Theme;
  onToggleTheme: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  showDeviceSelect?: boolean;
  showTitle?: boolean;
  showThemeToggle?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  devices,
  selectedDevice,
  onSelectDevice,
  isLogging,
  onToggleLogging,
  onClearLogs,
  filters,
  onFilterChange,
  selectedPlatform = 'android',
  theme,
  onToggleTheme,
  isCollapsed,
  onToggleCollapse,
  showDeviceSelect = true,
  showTitle = true,
  showThemeToggle = true
}) => {
  const isDark = theme === 'dark';
  const bgColor = isDark ? 'bg-zinc-900' : 'bg-white';
  const borderColor = isDark ? 'border-zinc-800' : 'border-slate-200';
  const textColor = isDark ? 'text-zinc-400' : 'text-slate-500';
  const inputBg = isDark ? 'bg-zinc-950' : 'bg-slate-50';
  const inputBorder = isDark ? 'border-zinc-800' : 'border-slate-200';
  const inputPlaceholder = isDark ? 'placeholder-zinc-600' : 'placeholder-slate-400';
  const inputText = isDark ? 'text-zinc-200' : 'text-slate-900';

  if (isCollapsed) {
    return (
      <div className={`w-14 ${bgColor} ${textColor} flex flex-col h-full border-r ${borderColor} transition-all duration-300 items-center py-4 relative group shrink-0`}>
        <button 
            onClick={onToggleCollapse}
            className={`absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-10 rounded-full flex items-center justify-center border shadow-sm z-50 opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-800'}`}
        >
            <ChevronRight size={14} />
        </button>

        <div className="flex flex-col gap-4 w-full px-2 mt-2">
             <button
                onClick={onToggleLogging}
                disabled={!selectedDevice}
                className={`w-full aspect-square flex items-center justify-center rounded-xl transition-all ${
                  !selectedDevice 
                    ? `${isDark ? 'bg-zinc-800/50 text-zinc-700' : 'bg-slate-100 text-slate-300'} cursor-not-allowed`
                    : isLogging 
                      ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' 
                      : 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-900/20'
                }`}
                title={isLogging ? "Stop Logging" : "Start Logging"}
              >
                {isLogging ? <Square size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>

              <button
                onClick={onClearLogs}
                className={`w-full aspect-square flex items-center justify-center rounded-xl transition-colors ${isDark ? 'bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-white' : 'bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-800'} border ${borderColor}`}
                title="Clear Logs"
              >
                <Trash2 size={18} />
              </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-72 ${bgColor} ${textColor} flex flex-col h-full border-r ${borderColor} transition-all duration-300 relative group shrink-0`}>
       <button 
            onClick={onToggleCollapse}
            className={`absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-10 rounded-full flex items-center justify-center border shadow-sm z-50 opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-800'}`}
        >
            <ChevronLeft size={14} />
        </button>

      <div className={`p-5 space-y-4`}>
        {showTitle && (
          <h1 className={`text-lg font-bold flex items-center gap-3 ${isDark ? 'text-white' : 'text-slate-900'} tracking-tight`}>
            <div className="relative flex items-center justify-center w-8 h-8 bg-blue-600 rounded-lg shadow-lg shadow-blue-500/20">
                <Terminal size={18} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="font-extrabold tracking-tight">MKTools</span>
          </h1>
        )}
        
        {showDeviceSelect && (
          <div>
            <label className={`block text-[10px] font-bold ${isDark ? 'text-zinc-400' : 'text-zinc-500'} mb-2 uppercase tracking-widest`}>Connected Device</label>
            <div className="relative">
              <select 
                className={`w-full appearance-none ${inputBg} border ${inputBorder} rounded-xl px-3 py-2.5 text-sm ${inputText} focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer hover:border-blue-500/50`}
                value={selectedDevice}
                onChange={(e) => onSelectDevice(e.target.value)}
              >
                <option value="">Select a device...</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.platform})
                  </option>
                ))}
              </select>
              <div className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}>
                 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onToggleLogging}
            disabled={!selectedDevice}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              !selectedDevice 
                ? `${isDark ? 'bg-zinc-800 text-zinc-600' : 'bg-slate-100 text-slate-300'} cursor-not-allowed`
                : isLogging 
                  ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 active:scale-[0.98]' 
                  : 'bg-green-600 text-white hover:bg-green-700 active:scale-[0.98] shadow-lg shadow-green-900/20'
            }`}
          >
            {isLogging ? <><Square size={16} fill="currentColor" /> STOP</> : <><Play size={16} fill="currentColor" /> START</>}
          </button>
          
          <button
            onClick={onClearLogs}
            className={`px-3.5 rounded-xl border transition-all active:scale-[0.95] ${
              isDark 
                ? 'bg-zinc-800/50 hover:bg-zinc-800 border-zinc-800 text-zinc-400 hover:text-white' 
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-400 hover:text-slate-800'
            }`}
            title="Clear Logs"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar border-t border-zinc-800/50">
        <div className={`flex items-center gap-2 mb-6 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            <Filter size={14} />
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em]">Live Filters</h2>
        </div>
        
        <div className="space-y-6">
          <div className="group">
            <label className={`block text-[10px] font-bold ${isDark ? 'text-zinc-400' : 'text-zinc-500'} mb-2 group-focus-within:text-blue-500 transition-colors uppercase tracking-widest`}>
              {selectedPlatform === 'ios' ? 'Log Type' : 'Log Level'}
            </label>
            <div className="relative">
                <select
                  className={`w-full appearance-none ${inputBg} border ${inputBorder} rounded-lg px-3 py-2 text-xs ${inputText} focus:outline-none focus:border-blue-500/50 transition-all hover:border-blue-500/30`}
                  value={filters.level}
                  onChange={(e) => onFilterChange({ ...filters, level: e.target.value })}
                >
                  {selectedPlatform === 'ios' ? (
                    <>
                      <option value="V">All Types</option>
                      <option value="D">Debug</option>
                      <option value="I">Info</option>
                      <option value="W">Warning</option>
                      <option value="E">Error</option>
                      <option value="F">Fault</option>
                    </>
                  ) : (
                    <>
                      <option value="V">Verbose</option>
                      <option value="D">Debug</option>
                      <option value="I">Info</option>
                      <option value="W">Warn</option>
                      <option value="E">Error</option>
                    </>
                  )}
                </select>
                <div className={`absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
            </div>
          </div>

          <div className="group">
            <label className={`block text-[10px] font-bold ${isDark ? 'text-zinc-400' : 'text-zinc-500'} mb-2 group-focus-within:text-blue-500 transition-colors uppercase tracking-widest`}>
              {selectedPlatform === 'ios' ? 'Process (Regex)' : 'Tag (Regex)'}
            </label>
            <div className="relative">
                <Tag size={12} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-zinc-600' : 'text-slate-400'} group-focus-within:text-blue-500 transition-colors`} />
                <input 
                  type="text" 
                  className={`w-full ${inputBg} border ${inputBorder} rounded-lg pl-8 pr-3 py-2 text-xs ${inputText} ${inputPlaceholder} focus:outline-none focus:border-blue-500/50 transition-all`}
                  placeholder={selectedPlatform === 'ios' ? 'e.g. kernel' : 'e.g. ActivityManager'}
                  value={filters.tag}
                  onChange={(e) => onFilterChange({...filters, tag: e.target.value})}
                />
            </div>
          </div>

          {selectedPlatform !== 'ios' && (
            <div className="group">
              <label className={`block text-[10px] font-bold ${isDark ? 'text-zinc-400' : 'text-zinc-500'} mb-2 group-focus-within:text-blue-500 transition-colors uppercase tracking-widest`}>PID</label>
              <div className="relative">
                  <Hash size={12} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-zinc-600' : 'text-slate-400'} group-focus-within:text-blue-500 transition-colors`} />
                  <input 
                    type="text"
                    className={`w-full ${inputBg} border ${inputBorder} rounded-lg pl-8 pr-3 py-2 text-xs ${inputText} ${inputPlaceholder} focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all`}
                    placeholder="Filter by PID..."
                    value={filters.pid}
                    onChange={(e) => onFilterChange({...filters, pid: e.target.value})}
                  />
              </div>
            </div>
          )}

           <div className="group">
            <label className={`block text-[10px] font-bold ${isDark ? 'text-zinc-400' : 'text-zinc-500'} mb-2 group-focus-within:text-blue-500 transition-colors uppercase tracking-widest`}>Search Message</label>
            <div className="relative">
                <Search size={12} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-zinc-600' : 'text-slate-400'} group-focus-within:text-blue-500 transition-colors`} />
                <input 
                  type="text" 
                  className={`w-full ${inputBg} border ${inputBorder} rounded-lg pl-8 pr-3 py-2 text-xs ${inputText} ${inputPlaceholder} focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all`}
                  placeholder="Search in logs..."
                  value={filters.search}
                  onChange={(e) => onFilterChange({...filters, search: e.target.value})}
                />
            </div>
          </div>
        </div>
      </div>
      
      <div className={`px-4 py-1.5 border-t ${borderColor} text-[10px] ${isDark ? 'text-zinc-600' : 'text-slate-400'} ${bgColor} flex items-center justify-between shrink-0 h-9`}>
        <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${devices.length > 0 ? 'bg-green-500 animate-pulse' : (isDark ? 'bg-zinc-700' : 'bg-slate-200')}`}></div>
            <span className="font-bold tracking-tight uppercase">{devices.length} DEVICE{devices.length !== 1 && 'S'} FOUND</span>
        </div>
        
        {showThemeToggle && (
          <div className="flex items-center gap-3">
               <div className="flex items-center gap-2">
                  <button 
                      onClick={onToggleTheme}
                      className={`relative w-10 h-5 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                          isDark ? 'bg-zinc-700 ring-offset-zinc-900' : 'bg-slate-200 ring-offset-white'
                      }`}
                      title={`Switch to ${isDark ? 'Light' : 'Dark'} Mode`}
                  >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transform transition-transform duration-300 flex items-center justify-center ${
                          isDark ? 'translate-x-5 bg-zinc-400' : 'translate-x-0 bg-white'
                      }`}>
                          {isDark 
                              ? <Moon size={10} className="text-zinc-800 fill-zinc-800" /> 
                              : <Sun size={10} className="text-amber-500 fill-amber-500" />
                          }
                      </div>
                  </button>
               </div>
          </div>
        )}
      </div>
    </div>
  );
};
