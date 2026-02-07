import React, { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { LogEntry, Theme } from '../types';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { Terminal } from 'lucide-react';

interface LogViewerProps {
  logs: LogEntry[];
  autoScroll: boolean;
  onScroll: (isAtBottom: boolean) => void;
  onToggleAutoScroll: () => void;
  platform?: 'android' | 'ios';
  theme: Theme;
  onClearLogs?: () => void;
  hasSelectedDevice?: boolean;
}

const getLevelColor = (level: string, theme: Theme) => {
  const isDark = theme === 'dark';
  switch (level?.toUpperCase()) {
    case 'V': return isDark ? 'text-zinc-400' : 'text-slate-600';
    case 'D': return isDark ? 'text-blue-400' : 'text-blue-700';
    case 'I': return isDark ? 'text-green-400' : 'text-green-700';
    case 'W': return isDark ? 'text-yellow-400' : 'text-amber-700';
    case 'E': return isDark ? 'text-red-400 font-medium' : 'text-red-700 font-medium';
    case 'F': return isDark ? 'text-purple-400 font-bold' : 'text-purple-800 font-bold';
    default: return isDark ? 'text-zinc-400' : 'text-slate-600';
  }
};

const getMessageColor = (level: string, theme: Theme) => {
    const isDark = theme === 'dark';
    switch (level?.toUpperCase()) {
      case 'V': return isDark ? 'text-zinc-400' : 'text-slate-600';
      case 'D': return isDark ? 'text-blue-300' : 'text-blue-800';
      case 'I': return isDark ? 'text-zinc-300' : 'text-slate-900'; // Info 保持默认颜色
      case 'W': return isDark ? 'text-yellow-300' : 'text-amber-800';
      case 'E': return isDark ? 'text-red-500' : 'text-red-800';
      case 'F': return isDark ? 'text-purple-300' : 'text-purple-900';
      default: return isDark ? 'text-zinc-300' : 'text-slate-900';
    }
  };

const getTagColor = (level: string, theme: Theme) => {
    switch (level?.toUpperCase()) {
      case 'I': return theme === 'dark' ? 'text-zinc-300' : 'text-slate-700'; // Info 特殊处理
      default: return getMessageColor(level, theme); // 其他级别同步 Message 颜色
    }
};

const getLevelBadgeClass = (level: string, theme: Theme) => {
    const isDark = theme === 'dark';
    switch (level?.toUpperCase()) {
      case 'V': return isDark ? 'bg-zinc-800 text-zinc-400 border-zinc-700' : 'bg-slate-200 text-slate-700 border-slate-300';
      case 'D': return isDark ? 'bg-blue-900/30 text-blue-300 border-blue-800/50' : 'bg-blue-100 text-blue-800 border-blue-300';
      case 'I': return isDark ? 'bg-green-900/30 text-green-300 border-green-800/50' : 'bg-green-100 text-green-800 border-green-300';
      case 'W': return isDark ? 'bg-yellow-900/30 text-yellow-300 border-yellow-800/50' : 'bg-amber-100 text-amber-800 border-amber-300';
      case 'E': return isDark ? 'bg-red-900/30 text-red-300 border-red-800/50' : 'bg-red-100 text-red-800 border-red-300';
      case 'F': return isDark ? 'bg-purple-900/30 text-purple-300 border-purple-800/50' : 'bg-purple-100 text-purple-900 border-purple-300';
      default: return isDark ? 'bg-zinc-800 text-zinc-400 border-zinc-700' : 'bg-slate-200 text-slate-700 border-slate-300';
    }
  };

const getIosTypeLabel = (level: string) => {
  switch (level?.toUpperCase()) {
    case 'F': return 'Fault';
    case 'E': return 'Error';
    case 'W': return 'Warning';
    case 'D': return 'Debug';
    case 'I': return 'Info';
    default: return 'Default';
  }
};

// 紧急回退：使用最基础的列表渲染，不依赖任何第三方虚拟滚动库
// 以排除 react-virtuoso 导致的布局或渲染崩溃问题
export const LogViewer: React.FC<LogViewerProps> = ({ logs, autoScroll, onScroll, onToggleAutoScroll, platform = 'android', theme, onClearLogs, hasSelectedDevice = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(false);
  const userScrolledAway = useRef(false); // 新增：追踪用户是否主动滚动离开底部
  const frozenLogs = useRef<LogEntry[]>([]); // 暂停时冻结的日志
  const isDark = theme === 'dark';
  const [selectedLogs, setSelectedLogs] = useState<Set<number>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; logIndex: number | null } | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // 列宽状态管理 (单位: px)
  const [colWidths, setColWidths] = useState({
    time: 100,
    pid: 60,
    tid: 60,
    level: 50,
    tag: 160
  });

  // 关闭右键菜单
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // 当用户暂停滚动时，冻结日志数组，避免页面不断更新
  useEffect(() => {
    if (!autoScroll && userScrolledAway.current) {
      // 用户暂停了，冻结当前日志
      if (frozenLogs.current.length === 0 || frozenLogs.current !== logs) {
        frozenLogs.current = logs.slice(); // 创建副本
      }
    } else if (autoScroll) {
      // 恢复滚动，清空冻结
      frozenLogs.current = [];
    }
  }, [autoScroll]);

  // 决定显示哪些日志：暂停时显示冻结的日志，否则显示实时日志
  const displayLogs = autoScroll || frozenLogs.current.length === 0 ? logs : frozenLogs.current;

  // 处理键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+A 或 Cmd+A 全选
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const allIndices = new Set(displayLogs.map((_, index) => index));
        setSelectedLogs(allIndices);
        if (displayLogs.length > 0) {
          setLastSelectedIndex(displayLogs.length - 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayLogs]);

  // 当平台变化时，调整默认列宽
  useEffect(() => {
    if (platform === 'ios') {
      setColWidths(prev => ({
        ...prev,
        time: 110,
        pid: 0,
        tid: 0,
        level: 80,
        tag: 240
      }));
    } else {
      setColWidths(prev => ({
        ...prev,
        time: 100,
        tag: 160,
        pid: 60,
        tid: 60,
        level: 50
      }));
    }
  }, [platform]);


  // 处理列宽拖拽
  const handleResizeStart = (e: React.MouseEvent, colKey: keyof typeof colWidths) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[colKey];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setColWidths(prev => ({
        ...prev,
        [colKey]: Math.max(30, startWidth + deltaX) // 最小宽度 30px
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
  };

  // 使用 useLayoutEffect 确保在浏览器绘制前调整滚动位置，防止闪烁
  // 同时解决"明明有新日志却不滚动"的问题
  useLayoutEffect(() => {
    // 只有在自动滚动开启且用户没有主动滚动离开时才执行滚动
    if (autoScroll && !userScrolledAway.current && containerRef.current) {
      // 标记为正在自动滚动，防止 onScroll 事件误判为用户手动滚动
      isAutoScrolling.current = true;
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      
      // 在下一帧重置标志位，确保 onScroll 事件处理完毕
      requestAnimationFrame(() => {
          isAutoScrolling.current = false;
      });
    }
  }, [displayLogs, autoScroll]);

  const renderHeaderCell = (label: string, width: number, colKey: keyof typeof colWidths) => (
    <div 
        className={`relative shrink-0 flex items-center ${isDark ? 'bg-[#252529] text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/50' : 'bg-[#e2e8f0] text-slate-700 border-slate-300 hover:bg-slate-200'} font-semibold border-r transition-colors group`}
        style={{ width }}
    >
        <span className="px-2 truncate w-full text-[11px] uppercase tracking-wider">{label}</span>
        <div 
            className={`absolute right-0 top-1 bottom-1 w-[1px] ${isDark ? 'bg-zinc-700' : 'bg-slate-300'} group-hover:bg-blue-500/50 cursor-col-resize z-10`}
            onMouseDown={(e) => handleResizeStart(e, colKey)}
        />
    </div>
  );

  // 格式化日志为文本
  const formatLogAsText = (log: LogEntry): string => {
    if (platform === 'ios') {
      const time = log.timestamp && !isNaN(new Date(log.timestamp).getTime()) 
        ? format(new Date(log.timestamp), 'HH:mm:ss.SSS') 
        : log.timestamp;
      return `[${getIosTypeLabel(log.level)}] ${time} ${log.tag}: ${log.msg}`;
    } else {
      const time = log.timestamp && !isNaN(new Date(log.timestamp).getTime()) 
        ? format(new Date(log.timestamp), 'HH:mm:ss.SSS') 
        : log.timestamp;
      return `${time} ${log.pid} ${log.tid} ${log.level} ${log.tag}: ${log.msg}`;
    }
  };

  // 处理日志点击选择
  const handleLogClick = (index: number, e: React.MouseEvent) => {
    // 阻止事件冒泡
    e.stopPropagation();
    
    // 如果不是按住修饰键，清除文本选择
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      window.getSelection()?.removeAllRanges();
    }
    
    if (e.shiftKey && lastSelectedIndex !== null) {
      // Shift + 点击：选择范围
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const newSelected = new Set(selectedLogs);
      for (let i = start; i <= end; i++) {
        newSelected.add(i);
      }
      setSelectedLogs(newSelected);
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + 点击：切换单个选择
      const newSelected = new Set(selectedLogs);
      if (newSelected.has(index)) {
        newSelected.delete(index);
      } else {
        newSelected.add(index);
      }
      setSelectedLogs(newSelected);
      setLastSelectedIndex(index);
    } else {
      // 普通点击：单选
      setSelectedLogs(new Set([index]));
      setLastSelectedIndex(index);
    }
  };

  // 处理右键菜单
  const handleContextMenu = (e: React.MouseEvent, logIndex: number | null) => {
    e.preventDefault();
    
    // 如果右键的日志不在选中列表中，则只选中当前日志
    if (logIndex !== null && !selectedLogs.has(logIndex)) {
      setSelectedLogs(new Set([logIndex]));
      setLastSelectedIndex(logIndex);
    }
    
    // 计算菜单位置，避免超出屏幕
    const menuWidth = 180;
    const menuHeight = 100;
    
    let x = e.clientX;
    let y = e.clientY;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }
    
    x = Math.max(10, x);
    y = Math.max(10, y);
    
    setContextMenu({ x, y, logIndex });
  };

  // 复制日志
  const handleCopyLogs = async () => {
    try {
      let textToCopy = '';
      
      if (selectedLogs.size > 0) {
        // 复制选中的日志
        const sortedIndices = Array.from(selectedLogs).sort((a, b) => a - b);
        textToCopy = sortedIndices.map(index => formatLogAsText(displayLogs[index])).join('\n');
      } else if (contextMenu?.logIndex !== null && contextMenu?.logIndex !== undefined) {
        // 复制单行日志
        textToCopy = formatLogAsText(displayLogs[contextMenu.logIndex]);
      }
      
      if (textToCopy) {
        await navigator.clipboard.writeText(textToCopy);
      }
      
      setContextMenu(null);
    } catch (e) {
      console.error('复制失败:', e);
    }
  };

  // 清除日志
  const handleClearLogsClick = () => {
    if (onClearLogs) {
      onClearLogs();
    }
    setSelectedLogs(new Set());
    setLastSelectedIndex(null);
    setContextMenu(null);
  };

  return (
    <div className={`absolute inset-0 ${isDark ? 'bg-[#1e1e20] text-zinc-300' : 'bg-[#f1f5f9] text-slate-800'} flex flex-col font-mono`}>
       <div className={`flex border-b ${isDark ? 'border-zinc-700/50 bg-[#252529]' : 'border-slate-300 bg-[#e2e8f0]'} shrink-0 select-none h-8 shadow-sm z-10`}>
        {platform === 'ios' ? (
            <>
              {renderHeaderCell("Type", colWidths.level, "level")}
              {renderHeaderCell("Time", colWidths.time, "time")}
              {renderHeaderCell("Process", colWidths.tag, "tag")}
              <div className={`flex-1 px-3 flex items-center py-1 text-[11px] font-semibold ${isDark ? 'text-zinc-400' : 'text-slate-700'} uppercase tracking-wider`}>Message</div>
            </>
        ) : (
            <>
              {renderHeaderCell("Time", colWidths.time, "time")}
              {renderHeaderCell("PID", colWidths.pid, "pid")}
              {renderHeaderCell("TID", colWidths.tid, "tid")}
              {renderHeaderCell("Lvl", colWidths.level, "level")}
              {renderHeaderCell("Tag", colWidths.tag, "tag")}
              <div className={`flex-1 px-3 flex items-center py-1 text-[11px] font-semibold ${isDark ? 'text-zinc-400' : 'text-slate-700'} uppercase tracking-wider`}>Message</div>
            </>
        )}
      </div>
      
      <div 
        ref={containerRef}
        className="flex-1 overflow-auto custom-scrollbar"
        onContextMenu={(e) => handleContextMenu(e, null)}
        onScroll={(e) => {
            // 如果是程序自动滚动触发的事件，直接忽略，不改变 autoScroll 状态
            if (isAutoScrolling.current) return;

            const target = e.currentTarget;
            // 增加 10px 的容差，处理不同缩放比例下的精度问题，让吸附更稳定
            const isAtBottom = Math.abs(target.scrollHeight - target.scrollTop - target.clientHeight) < 10;
            
            // 只有当用户确实向上滚动离开了底部，才取消自动滚动
            if (!isAtBottom) {
                userScrolledAway.current = true; // 标记用户已滚动离开
                if (autoScroll) {
                    onScroll(false);
                }
            } else {
                userScrolledAway.current = false; // 用户回到底部，清除标记
                // 如果用户手动滚回到底部，恢复自动滚动
                if (!autoScroll) {
                    onScroll(true);
                }
            }
        }}
      >
        {displayLogs.length === 0 && (
            <div className={`flex flex-col items-center justify-center h-full ${isDark ? 'text-zinc-600' : 'text-slate-400'} gap-4 opacity-50`}>
                <Terminal size={48} strokeWidth={1} />
                <div className="text-sm font-medium">Waiting for logs...</div>
            </div>
        )}
        
        {displayLogs.map((log, index) => {
             const isSelected = selectedLogs.has(index);
             return (
             <div 
                key={`${log.id}-${index}`}
                className={clsx(
                    `flex border-b py-1 items-start text-[11px] leading-relaxed group transition-colors cursor-pointer`,
                    isDark ? 'border-zinc-700/30' : 'border-slate-300/50',
                    getLevelColor(log.level, theme),
                    // 亮色模式下整体字体稍微加粗
                    !isDark && "font-medium",
                    // 选中状态（优先级最高）
                    isSelected ? (
                      isDark ? "bg-blue-900/30 hover:bg-blue-900/40" : "bg-blue-200/50 hover:bg-blue-200/70"
                    ) : (
                      // 未选中状态：斑马纹 + hover
                      index % 2 === 0 
                        ? (isDark ? "bg-[#1e1e20] hover:bg-zinc-700/30" : "bg-[#f1f5f9] hover:bg-slate-200/50")
                        : (isDark ? "bg-[#232326] hover:bg-zinc-700/30" : "bg-[#e6ecf0] hover:bg-slate-200/50")
                    )
                )}
                onClick={(e) => handleLogClick(index, e)}
                onContextMenu={(e) => handleContextMenu(e, index)}
            >
                {platform === 'ios' ? (
                    <>
                        <div className="shrink-0 px-2 overflow-hidden whitespace-nowrap pt-0.5" style={{ width: colWidths.level }}>
                          <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-[3px] border text-[9px] font-medium min-w-[50px] ${getLevelBadgeClass(log.level, theme)}`}>
                            {getIosTypeLabel(log.level)}
                          </span>
                        </div>
                        <div className={clsx("shrink-0 px-3 overflow-hidden whitespace-nowrap select-all pt-0.5 font-mono transition-colors", getTagColor(log.level, theme))} style={{ width: colWidths.time }}>
                            {log.timestamp && !isNaN(new Date(log.timestamp).getTime()) ? format(new Date(log.timestamp), 'HH:mm:ss.SSS') : log.timestamp}
                        </div>
                        <div className={clsx("shrink-0 truncate font-semibold px-3 select-all pt-0.5 transition-colors", getTagColor(log.level, theme))} title={log.tag} style={{ width: colWidths.tag }}>
                            {log.tag}
                        </div>
                        <div className={clsx("flex-1 whitespace-pre-wrap break-all px-3 select-text transition-colors", getMessageColor(log.level, theme))}>{log.msg}</div>
                    </>
                ) : (
                    <>
                        <div className={clsx("shrink-0 px-3 overflow-hidden whitespace-nowrap select-all pt-0.5 font-mono transition-colors", getTagColor(log.level, theme))} style={{ width: colWidths.time }}>
                            {log.timestamp && !isNaN(new Date(log.timestamp).getTime()) ? format(new Date(log.timestamp), 'HH:mm:ss.SSS') : log.timestamp}
                        </div>
                        <div className={clsx("shrink-0 px-3 overflow-hidden whitespace-nowrap select-all pt-0.5 transition-colors", getTagColor(log.level, theme))} style={{ width: colWidths.pid }}>{log.pid}</div>
                        <div className={clsx("shrink-0 px-3 overflow-hidden whitespace-nowrap select-all pt-0.5 transition-colors", getTagColor(log.level, theme))} style={{ width: colWidths.tid }}>{log.tid}</div>
                        <div className="shrink-0 font-bold px-3 overflow-hidden whitespace-nowrap pt-0.5" style={{ width: colWidths.level }}>
                            <span className={clsx("inline-block w-4 text-center", (log.level === 'E' || log.level === 'F') ? (isDark ? "text-red-500" : "text-red-600") : "")}>{log.level}</span>
                        </div>
                        <div className={clsx("shrink-0 truncate font-medium px-3 select-all pt-0.5 transition-colors", getTagColor(log.level, theme))} title={log.tag} style={{ width: colWidths.tag }}>{log.tag}</div>
                        <div className={clsx("flex-1 whitespace-pre-wrap break-all px-3 select-text transition-colors", getMessageColor(log.level, theme))}>{log.msg}</div>
                    </>
                )}
            </div>
             );
        })}
      </div>

      {/* 底部快捷键工具栏 */}
      <div className={`shrink-0 border-t ${isDark ? 'border-zinc-800 bg-[#1a1a1d]' : 'border-slate-300 bg-white'} px-3 py-1.5 flex items-center gap-4 text-[10px] ${isDark ? 'text-zinc-400' : 'text-slate-600'} h-9`}>
        <div className="flex items-center gap-1.5">
          <kbd className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700 border border-zinc-600' : 'bg-slate-100 border border-slate-300'} font-mono`}>Click</kbd>
          <span>单选</span>
        </div>
        <div className="flex items-center gap-1.5">
          <kbd className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700 border border-zinc-600' : 'bg-slate-100 border border-slate-300'} font-mono`}>Shift</kbd>
          <span>+</span>
          <kbd className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700 border border-zinc-600' : 'bg-slate-100 border border-slate-300'} font-mono`}>Click</kbd>
          <span>范围选择</span>
        </div>
        <div className="flex items-center gap-1.5">
          <kbd className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700 border border-zinc-600' : 'bg-slate-100 border border-slate-300'} font-mono`}>{navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}</kbd>
          <span>+</span>
          <kbd className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700 border border-zinc-600' : 'bg-slate-100 border border-slate-300'} font-mono`}>Click</kbd>
          <span>多选</span>
        </div>
        <div className="flex items-center gap-1.5">
          <kbd className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700 border border-zinc-600' : 'bg-slate-100 border border-slate-300'} font-mono`}>{navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}</kbd>
          <span>+</span>
          <kbd className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700 border border-zinc-600' : 'bg-slate-100 border border-slate-300'} font-mono`}>A</kbd>
          <span>全选</span>
        </div>
        <div className="flex items-center gap-1.5">
          <kbd className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700 border border-zinc-600' : 'bg-slate-100 border border-slate-300'} font-mono`}>右键</kbd>
          <span>复制/清除</span>
        </div>
        {selectedLogs.size > 0 && (
          <div className={`ml-auto flex items-center gap-2 ${isDark ? 'text-blue-400' : 'text-blue-600'} font-medium`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>已选中 {selectedLogs.size} 行</span>
          </div>
        )}
      </div>

      {/* 悬浮自动滚动按钮 */}
      {hasSelectedDevice && logs.length > 0 && (
      <button
        onClick={() => {
          onToggleAutoScroll();
          // 如果是从暂停切换到自动滚动，立即滚动到底部
          if (!autoScroll && containerRef.current) {
            userScrolledAway.current = false;
            frozenLogs.current = [];
            setTimeout(() => {
              if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
              }
            }, 50);
          }
        }}
        className={`fixed bottom-16 right-6 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-xl font-medium text-xs transition-all duration-200 active:scale-95 ${
          autoScroll
            ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/30'
            : (isDark 
                ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700' 
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-300')
        }`}
        title={autoScroll ? '点击关闭自动滚动' : '点击开启自动滚动'}
      >
        <svg 
          width="14" 
          height="14" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className={autoScroll ? 'animate-bounce' : ''}
        >
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <polyline points="19 12 12 19 5 12"></polyline>
        </svg>
        <span className="font-sans">{autoScroll ? '自动滚动' : '已暂停'}</span>
      </button>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className={`fixed z-50 ${isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-slate-300'} border rounded-lg shadow-xl py-1 min-w-[180px]`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
            onClick={handleCopyLogs}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            {selectedLogs.size > 1 ? `复制选中的日志 (${selectedLogs.size})` : '复制日志'}
          </button>
          <div className={`h-px ${isDark ? 'bg-zinc-700' : 'bg-slate-200'} my-1`} />
          <button
            className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-red-400' : 'hover:bg-slate-100 text-red-600'} flex items-center gap-2`}
            onClick={handleClearLogsClick}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            清除日志
          </button>
        </div>
      )}
    </div>
  );
};
