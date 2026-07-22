import React, { useRef, useEffect, useState } from 'react';
import { VariableSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
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
  isLogging?: boolean;
  highlight?: string;
}

// 单行文本高度（px）。为支持多行日志（JSON/堆栈）按行数完整展开，采用可变行高。
const LINE_HEIGHT = 18;
const ROW_VPAD = 4; // 行上下内边距合计
// 统计消息占用的物理行数（按 \n 计），用于计算该条日志的显示高度
const getLineCount = (msg: string): number => {
  if (!msg) return 1;
  let n = 1;
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] === '\n') n++;
  }
  return n;
};
const getItemSize = (msg: string): number => getLineCount(msg) * LINE_HEIGHT + ROW_VPAD;

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

const formatTime = (timestamp: string) => {
  return timestamp && !isNaN(new Date(timestamp).getTime())
    ? format(new Date(timestamp), 'HH:mm:ss.SSS')
    : timestamp;
};

// 将文本中匹配 keyword 的部分高亮显示（keyword 支持正则，非法则退化为纯文本匹配）
const renderHighlighted = (text: string, keyword: string, isDark: boolean): React.ReactNode => {
  const kw = keyword?.trim();
  if (!kw) return text;

  let regex: RegExp;
  try {
    regex = new RegExp(kw, 'gi');
  } catch {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, 'gi');
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  const markClass = isDark ? 'bg-yellow-500/40 text-inherit rounded-[2px]' : 'bg-yellow-300/70 text-inherit rounded-[2px]';

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(<mark key={key++} className={markClass}>{match[0]}</mark>);
    lastIndex = match.index + match[0].length;
    // 防止空匹配导致死循环
    if (match.index === regex.lastIndex) regex.lastIndex++;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : text;
};

// 格式化日志为文本（用于复制/导出）
const formatLogAsText = (log: LogEntry, platform: 'android' | 'ios'): string => {
  const time = formatTime(log.timestamp);
  if (platform === 'ios') {
    return `[${getIosTypeLabel(log.level)}] ${time} ${log.tag}: ${log.msg}`;
  }
  return `${time} ${log.pid} ${log.tid} ${log.level} ${log.tag}: ${log.msg}`;
};

interface ColWidths {
  time: number;
  pid: number;
  tid: number;
  level: number;
  tag: number;
}

interface RowData {
  logs: LogEntry[];
  selectedIds: Set<number>;
  colWidths: ColWidths;
  theme: Theme;
  isDark: boolean;
  platform: 'android' | 'ios';
  highlight: string;
  onRowClick: (index: number, e: React.MouseEvent) => void;
  onRowContextMenu: (e: React.MouseEvent, index: number) => void;
}

// 单行日志（虚拟滚动的行渲染单元）
const LogRow: React.FC<ListChildComponentProps<RowData>> = ({ index, style, data }) => {
  const { logs, selectedIds, colWidths, theme, isDark, platform, highlight, onRowClick, onRowContextMenu } = data;
  const log = logs[index];
  if (!log) return null;

  const isSelected = selectedIds.has(log.id);

  return (
    <div
      style={style}
      className={clsx(
        'flex items-start text-[11px] leading-[18px] group cursor-pointer border-b py-0.5',
        isDark ? 'border-zinc-700/30' : 'border-slate-300/50',
        getLevelColor(log.level, theme),
        !isDark && 'font-medium',
        isSelected
          ? (isDark ? 'bg-blue-900/30 hover:bg-blue-900/40' : 'bg-blue-200/50 hover:bg-blue-200/70')
          : (index % 2 === 0
              ? (isDark ? 'bg-[#1F1F1F] hover:bg-zinc-700/30' : 'bg-[#ffffff] hover:bg-slate-200/50')
              : (isDark ? 'bg-[#242424] hover:bg-zinc-700/30' : 'bg-[#f8f8f8] hover:bg-slate-200/50'))
      )}
      onClick={(e) => onRowClick(index, e)}
      onContextMenu={(e) => onRowContextMenu(e, index)}
    >
      {platform === 'ios' ? (
        <>
          <div className="shrink-0 px-2 overflow-hidden whitespace-nowrap" style={{ width: colWidths.level }}>
            <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-[3px] border text-[9px] font-medium min-w-[50px] ${getLevelBadgeClass(log.level, theme)}`}>
              {getIosTypeLabel(log.level)}
            </span>
          </div>
          <div className={clsx('shrink-0 px-3 overflow-hidden whitespace-nowrap font-mono', getTagColor(log.level, theme))} style={{ width: colWidths.time }}>
            {formatTime(log.timestamp)}
          </div>
          <div className={clsx('shrink-0 truncate font-semibold px-3', getTagColor(log.level, theme))} title={log.tag} style={{ width: colWidths.tag }}>
            {log.tag}
          </div>
          <div className={clsx('flex-1 whitespace-pre overflow-x-auto px-3 select-text custom-scrollbar', getMessageColor(log.level, theme))}>
            {renderHighlighted(log.msg, highlight, isDark)}
          </div>
        </>
      ) : (
        <>
          <div className={clsx('shrink-0 px-3 overflow-hidden whitespace-nowrap font-mono', getTagColor(log.level, theme))} style={{ width: colWidths.time }}>
            {formatTime(log.timestamp)}
          </div>
          <div className={clsx('shrink-0 px-3 overflow-hidden whitespace-nowrap', getTagColor(log.level, theme))} style={{ width: colWidths.pid }}>{log.pid}</div>
          <div className={clsx('shrink-0 px-3 overflow-hidden whitespace-nowrap', getTagColor(log.level, theme))} style={{ width: colWidths.tid }}>{log.tid}</div>
          <div className="shrink-0 font-bold px-3 overflow-hidden whitespace-nowrap" style={{ width: colWidths.level }}>
            <span className={clsx('inline-block w-4 text-center', (log.level === 'E' || log.level === 'F') ? (isDark ? 'text-red-500' : 'text-red-600') : '')}>{log.level}</span>
          </div>
          <div className={clsx('shrink-0 truncate font-medium px-3', getTagColor(log.level, theme))} title={log.tag} style={{ width: colWidths.tag }}>{log.tag}</div>
          <div className={clsx('flex-1 whitespace-pre overflow-x-auto px-3 select-text custom-scrollbar', getMessageColor(log.level, theme))}>
            {renderHighlighted(log.msg, highlight, isDark)}
          </div>
        </>
      )}
    </div>
  );
};

export const LogViewer: React.FC<LogViewerProps> = ({ logs, autoScroll, onScroll, onToggleAutoScroll, platform = 'android', theme, onClearLogs, hasSelectedDevice = false, isLogging = false, highlight = '' }) => {
  const listRef = useRef<List>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const userScrolledAway = useRef(false); // 追踪用户是否主动滚动离开底部
  const frozenLogs = useRef<LogEntry[]>([]); // 暂停时冻结的日志快照
  const isDark = theme === 'dark';
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; logIndex: number | null } | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // 列宽状态管理 (单位: px)
  const [colWidths, setColWidths] = useState<ColWidths>({
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

  // 当外部清空日志时，重置冻结状态与选中
  useEffect(() => {
    if (logs.length === 0) {
      frozenLogs.current = [];
      userScrolledAway.current = false;
      setSelectedIds(new Set());
      setLastSelectedIndex(null);
    }
  }, [logs]);

  // 当用户暂停滚动时，冻结日志数组，避免页面不断更新
  useEffect(() => {
    if (!autoScroll && userScrolledAway.current) {
      if (frozenLogs.current.length === 0 || frozenLogs.current !== logs) {
        frozenLogs.current = logs.slice();
      }
    } else if (autoScroll) {
      frozenLogs.current = [];
    }
  }, [autoScroll]);

  // 决定显示哪些日志：暂停时显示冻结的日志，否则显示实时日志
  const displayLogs = autoScroll || frozenLogs.current.length === 0 ? logs : frozenLogs.current;

  // 处理键盘快捷键：Ctrl/Cmd + A 全选
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(displayLogs.map(l => l.id)));
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
      setColWidths(prev => ({ ...prev, time: 110, pid: 0, tid: 0, level: 80, tag: 240 }));
    } else {
      setColWidths(prev => ({ ...prev, time: 100, tag: 160, pid: 60, tid: 60, level: 50 }));
    }
  }, [platform]);

  // 处理列宽拖拽
  const handleResizeStart = (e: React.MouseEvent, colKey: keyof ColWidths) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[colKey];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setColWidths(prev => ({ ...prev, [colKey]: Math.max(30, startWidth + deltaX) }));
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

  // 数据变化时重置可变行高缓存（VariableSizeList 必需），并在需要时自动滚动到底部
  useEffect(() => {
    listRef.current?.resetAfterIndex(0);
    if (autoScroll && !userScrolledAway.current && listRef.current && displayLogs.length > 0) {
      listRef.current.scrollToItem(displayLogs.length - 1, 'end');
    }
  }, [displayLogs, autoScroll]);

  // 虚拟列表滚动事件：判断用户是否离开底部
  const handleListScroll = ({ scrollOffset, scrollUpdateWasRequested }: { scrollOffset: number; scrollUpdateWasRequested: boolean }) => {
    // 程序触发的滚动（scrollToItem）直接忽略，避免误判为用户操作
    if (scrollUpdateWasRequested) return;
    const el = outerRef.current;
    if (!el) return;
    const isAtBottom = Math.abs(el.scrollHeight - scrollOffset - el.clientHeight) < 20;
    if (!isAtBottom) {
      userScrolledAway.current = true;
      if (autoScroll) onScroll(false);
    } else {
      userScrolledAway.current = false;
      if (!autoScroll) onScroll(true);
    }
  };

  const renderHeaderCell = (label: string, width: number, colKey: keyof ColWidths) => (
    <div
      className={`relative shrink-0 flex items-center ${isDark ? 'bg-[#181818] text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/50' : 'bg-[#f8f8f8] text-slate-700 border-slate-300 hover:bg-slate-200'} font-semibold border-r transition-colors group`}
      style={{ width }}
    >
      <span className="px-2 truncate w-full text-[11px] uppercase tracking-wider">{label}</span>
      <div
        className={`absolute right-0 top-1 bottom-1 w-[1px] ${isDark ? 'bg-zinc-700' : 'bg-slate-300'} group-hover:bg-blue-500/50 cursor-col-resize z-10`}
        onMouseDown={(e) => handleResizeStart(e, colKey)}
      />
    </div>
  );

  // 处理日志点击选择（基于 log.id 记录，防止列表裁剪后错位）
  const handleRowClick = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const log = displayLogs[index];
    if (!log) return;

    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      window.getSelection()?.removeAllRanges();
    }

    if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const newSelected = new Set(selectedIds);
      for (let i = start; i <= end; i++) {
        const l = displayLogs[i];
        if (l) newSelected.add(l.id);
      }
      setSelectedIds(newSelected);
    } else if (e.ctrlKey || e.metaKey) {
      const newSelected = new Set(selectedIds);
      if (newSelected.has(log.id)) {
        newSelected.delete(log.id);
      } else {
        newSelected.add(log.id);
      }
      setSelectedIds(newSelected);
      setLastSelectedIndex(index);
    } else {
      setSelectedIds(new Set([log.id]));
      setLastSelectedIndex(index);
    }
  };

  // 处理右键菜单
  const handleContextMenu = (e: React.MouseEvent, logIndex: number | null) => {
    e.preventDefault();

    if (logIndex !== null) {
      const log = displayLogs[logIndex];
      if (log && !selectedIds.has(log.id)) {
        setSelectedIds(new Set([log.id]));
        setLastSelectedIndex(logIndex);
      }
    }

    const menuWidth = 200;
    const menuHeight = 140;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
    x = Math.max(10, x);
    y = Math.max(10, y);
    setContextMenu({ x, y, logIndex });
  };

  // 收集要操作的日志（优先选中项，否则右键当前项）
  const collectTargetLogs = (): LogEntry[] => {
    if (selectedIds.size > 0) {
      return displayLogs.filter(l => selectedIds.has(l.id));
    }
    if (contextMenu?.logIndex !== null && contextMenu?.logIndex !== undefined) {
      const l = displayLogs[contextMenu.logIndex];
      return l ? [l] : [];
    }
    return [];
  };

  // 复制日志
  const handleCopyLogs = async () => {
    try {
      const targets = collectTargetLogs();
      const textToCopy = targets.map(l => formatLogAsText(l, platform)).join('\n');
      if (textToCopy) {
        await navigator.clipboard.writeText(textToCopy);
      }
      setContextMenu(null);
    } catch (e) {
      console.error('复制失败:', e);
    }
  };

  // 导出日志到文件（有选中则导出选中，否则导出全部当前日志）
  const handleExportLogs = () => {
    const targets = selectedIds.size > 0
      ? displayLogs.filter(l => selectedIds.has(l.id))
      : displayLogs;
    if (targets.length === 0) {
      setContextMenu(null);
      return;
    }
    const text = targets.map(l => formatLogAsText(l, platform)).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logcat_${platform}_${format(new Date(), 'yyyyMMdd_HHmmss')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setContextMenu(null);
  };

  // 清除日志
  const handleClearLogsClick = () => {
    frozenLogs.current = [];
    userScrolledAway.current = false;
    if (onClearLogs) onClearLogs();
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
    setContextMenu(null);
  };

  const rowData: RowData = {
    logs: displayLogs,
    selectedIds,
    colWidths,
    theme,
    isDark,
    platform,
    highlight,
    onRowClick: handleRowClick,
    onRowContextMenu: handleContextMenu,
  };

  return (
    <div className={`absolute inset-0 ${isDark ? 'bg-[#1F1F1F] text-zinc-300' : 'bg-[#ffffff] text-slate-800'} flex flex-col font-mono`}>
       <div className={`flex border-b ${isDark ? 'border-zinc-700/50 bg-[#181818]' : 'border-slate-300 bg-[#f8f8f8]'} shrink-0 select-none h-8 shadow-sm z-10`}>
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

      <div className="flex-1 relative" onContextMenu={(e) => handleContextMenu(e, null)}>
        {displayLogs.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            {isLogging ? (
              <div className="flex flex-col items-center gap-3 opacity-40">
                <div className="w-12 h-12 rounded-full border-4 border-zinc-500/20 border-t-zinc-500 animate-spin" />
                <div className="text-zinc-500 text-xs font-medium uppercase tracking-widest">Waiting for stream...</div>
              </div>
            ) : (
              <div className={`flex flex-col items-center gap-4 opacity-50 ${isDark ? 'text-zinc-600' : 'text-slate-400'}`}>
                <Terminal size={48} strokeWidth={1} />
                <div className="text-sm font-medium">Waiting for logs...</div>
              </div>
            )}
          </div>
        ) : (
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <List
                ref={listRef}
                outerRef={outerRef}
                height={height}
                width={width}
                itemCount={displayLogs.length}
                itemSize={(index: number) => getItemSize(displayLogs[index]?.msg || '')}
                estimatedItemSize={22}
                itemData={rowData}
                overscanCount={20}
                onScroll={handleListScroll}
                className="custom-scrollbar"
              >
                {LogRow}
              </List>
            )}
          </AutoSizer>
        )}
      </div>

      {/* 底部快捷键工具栏 */}
      <div className={`shrink-0 border-t ${isDark ? 'border-zinc-800 bg-[#181818]' : 'border-slate-300 bg-white'} px-3 py-1.5 flex items-center gap-4 text-[10px] ${isDark ? 'text-zinc-400' : 'text-slate-600'} h-9`}>
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
          <span>复制/导出/清除</span>
        </div>
        <div className={`ml-auto flex items-center gap-4 ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}>
          {selectedIds.size > 0 && (
            <div className={`flex items-center gap-2 ${isDark ? 'text-blue-400' : 'text-blue-600'} font-medium`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>已选中 {selectedIds.size} 行</span>
            </div>
          )}
          <span className="font-medium tabular-nums">共 {displayLogs.length.toLocaleString()} 条</span>
        </div>
      </div>

      {/* 悬浮自动滚动按钮 */}
      {hasSelectedDevice && logs.length > 0 && (
      <button
        onClick={() => {
          onToggleAutoScroll();
          if (!autoScroll) {
            userScrolledAway.current = false;
            frozenLogs.current = [];
            setTimeout(() => {
              if (listRef.current && displayLogs.length > 0) {
                listRef.current.scrollToItem(displayLogs.length - 1, 'end');
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
          className={`fixed z-50 ${isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-slate-300'} border rounded-lg shadow-xl py-1 min-w-[190px]`}
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
            {selectedIds.size > 1 ? `复制选中的日志 (${selectedIds.size})` : '复制日志'}
          </button>
          <button
            className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
            onClick={handleExportLogs}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            {selectedIds.size > 0 ? `导出选中的日志 (${selectedIds.size})` : '导出全部日志'}
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
