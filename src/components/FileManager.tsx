import React, { useEffect, useMemo, useState } from 'react';
import { Theme, FileEntry } from '../types';
import { RefreshCw, FolderPlus, Upload, Download, Trash2, HardDrive, ChevronRight, ChevronDown, Folder, File, FolderOpen, CornerLeftUp, Lock } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface FileManagerProps {
  deviceId: string;
  platform: 'android' | 'ios';
  theme: Theme;
  onError: (msg: string | null) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  expanded?: boolean;
  loaded?: boolean;
  linkTarget?: string;
  resolvedPath?: string;
}

export const FileManager: React.FC<FileManagerProps> = ({ deviceId, platform, theme, onError }) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [iosApps, setIosApps] = useState<{ bundleId: string, name: string }[]>([]);
  const [bundleId, setBundleId] = useState<string>('');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: 'file' | 'folder' | 'empty' } | null>(null);
  const [promptDialog, setPromptDialog] = useState<{ title: string; message: string; defaultValue: string; onSubmit: (value: string) => void } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ 
    title: string; 
    message: string; 
    onConfirm: () => void; 
    confirmText?: string;
    secondaryAction?: { text: string; onAction: () => void };
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ percent: number; fileName: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ percent: number; fileName: string } | null>(null);
  const [installProgress, setInstallProgress] = useState<{ fileName: string } | null>(null);
  const [isJailbroken, setIsJailbroken] = useState<boolean>(false);
  const [initializing, setInitializing] = useState<boolean>(false);
  // 权限受限提示（仅当前目录），非空时右侧显示"需要 root 权限"占位符，不弹全局错误 toast
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // 判断错误是否为「权限受限」类，用于避免弹全局错误 toast，改为在列表区域显示友好占位符
  // 覆盖：Android (Permission denied) / iOS 越狱设备沙箱受限目录 (Operation not permitted)
  const isPermissionError = (msg: string | undefined): boolean => {
    if (!msg) return false;
    return (
      msg.includes('Permission denied') ||
      msg.includes('Operation not permitted') ||
      msg.includes('无权限') ||
      msg.includes('cannot open directory')
    );
  };

  // 检查选中的文件是否是可安装的应用包
  const isInstallableFile = useMemo(() => {
    if (!selected) return false;
    const lowerName = selected.toLowerCase();
    return lowerName.endsWith('.apk') || lowerName.endsWith('.ipa');
  }, [selected]);

  // 获取选中文件的类型
  const selectedFileType = useMemo(() => {
    if (!selected) return null;
    const lowerName = selected.toLowerCase();
    if (lowerName.endsWith('.apk')) return 'apk';
    if (lowerName.endsWith('.ipa')) return 'ipa';
    return null;
  }, [selected]);

  const isDark = theme === 'dark';
  const basePath = useMemo(() => {
    if (platform === 'android') return '/sdcard';
    return '/Documents';
  }, [platform]);

  // 关闭右键菜单
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    setTreeData([]);
    setSelectedPath('');
    setEntries([]);
    setSelected(null);
    setExpandedPaths(new Set());
    setIsJailbroken(false);
    setInitializing(false);
    // 切换设备时清除手动强制越狱标记（避免把 A 设备的确认套用到 B 设备）
    if (deviceId && platform === 'ios') {
      window.ipcRenderer.invoke('unset-forced-jailbreak', { deviceId }).catch(() => {});
    }
    
    if (platform === 'ios' && deviceId) {
      // iOS 设备：检查越狱状态，然后加载目录
      setIosApps([]);
      setBundleId(''); // 空 bundleId 表示访问媒体目录或系统根目录
      setInitializing(true); // 开始初始化
      
      // 检查越狱状态
      (async () => {
        try {
          console.log('[FileManager] Checking jailbreak status...');
          const jailbroken = await window.ipcRenderer.invoke('check-jailbreak', { deviceId });
          console.log('[FileManager] Jailbreak status:', jailbroken);
          setIsJailbroken(jailbroken);
        } catch (e) {
          console.error('[FileManager] Failed to check jailbreak:', e);
          setIsJailbroken(false);
        }
        // 等待状态更新后再加载目录树
        setTimeout(() => {
          loadRootTree();
          setInitializing(false); // 初始化完成
        }, 100);
      })();
    }
    
    if (platform !== 'ios') {
      setIosApps([]);
      setBundleId('');
      if (deviceId) {
        loadRootTree();
      }
    }
  }, [deviceId, platform, basePath]);

  // 手动强制以越狱模式访问：清除缓存 → 登记强制标记 → 重新加载根目录
  const forceJailbrokenMode = async () => {
    if (!deviceId) return;
    try {
      setInitializing(true);
      await window.ipcRenderer.invoke('clear-jailbreak-cache', { deviceId });
      await window.ipcRenderer.invoke('set-forced-jailbreak', { deviceId, password: 'alpine', remotePort: 22 });
      setIsJailbroken(true);
      // 重置状态，重新加载
      setTreeData([]);
      setEntries([]);
      setSelectedPath('');
      setSelected(null);
      await loadRootTree();
    } catch (e: any) {
      onError(`切换到越狱模式失败: ${e?.message || e}`);
    } finally {
      setInitializing(false);
    }
  };

  // 重新自动检测（清缓存 → 重新走 checkJailbreak）
  const recheckJailbreak = async () => {
    if (!deviceId) return;
    try {
      setInitializing(true);
      await window.ipcRenderer.invoke('unset-forced-jailbreak', { deviceId });
      await window.ipcRenderer.invoke('clear-jailbreak-cache', { deviceId });
      const jailbroken = await window.ipcRenderer.invoke('check-jailbreak', { deviceId });
      setIsJailbroken(jailbroken);
      setTreeData([]);
      setEntries([]);
      setSelectedPath('');
      setSelected(null);
      await loadRootTree();
    } catch (e: any) {
      onError(`重新检测越狱状态失败: ${e?.message || e}`);
    } finally {
      setInitializing(false);
    }
  };

  const loadRootTree = async () => {
    if (!deviceId) return;
    // 对于 iOS，如果没有 bundleId（系统根目录模式），也允许加载
    // if (platform === 'ios' && !bundleId) return;  // 移除这个检查
    
    setLoading(true);
    try {
      const rootPath = platform === 'android' ? '/' : '/';
      const list = await window.ipcRenderer.invoke('fs-list', {
        deviceId,
        platform,
        path: rootPath,
        bundleId: bundleId || undefined,  // 如果是空字符串，传 undefined
        skipSymlinkResolution: false  // 左侧目录树需要解析符号链接，过滤无效的
      });

      // 后端将"权限受限"作为业务结果返回（非数组），根目录都读不了就直接置空
      if (list && !Array.isArray(list) && list.permissionDenied) {
        console.warn(`[FileManager] Root dir permission denied: ${list.message}`);
        setTreeData([]);
        return;
      }

      const dirs = (list || []).filter((e: FileEntry) => e.isDir);
      
      const nodes: TreeNode[] = dirs.map((e: FileEntry) => {
        // 特殊处理 .. 父目录
        if (e.name === '..') {
          const parentPath = rootPath.split('/').slice(0, -1).join('/') || '/';
          return {
            name: e.name,
            path: parentPath,
            isDir: true,
            children: [],
            expanded: false,
            loaded: false
          };
        }
        
        return {
          name: e.name,
          path: rootPath === '/' ? `/${e.name}` : `${rootPath}/${e.name}`,
          isDir: true,
          children: [],
          expanded: false,
          loaded: false,
          linkTarget: e.linkTarget,
          resolvedPath: e.resolvedPath
        };
      });
      
      setTreeData(nodes);
      
      // 默认选中第一个目录（跳过 .. 如果它是第一个）
      const firstNonParent = nodes.find(n => n.name !== '..');
      if (firstNonParent) {
        loadDirectoryContent(firstNonParent.path);
      } else if (nodes.length > 0) {
        loadDirectoryContent(nodes[0].path);
      }
    } catch (e: any) {
      onError(e?.message || '加载目录树失败');
    } finally {
      setLoading(false);
    }
  };

  const loadDirectoryContent = async (path: string) => {
    if (!deviceId) return;
    // 对于 iOS，如果没有 bundleId（系统根目录模式），也允许加载
    // if (platform === 'ios' && !bundleId) return;  // 移除这个检查

    setSelectedPath(path);
    setPermissionError(null); // 切换目录时先清除上一次的权限提示
    setLoading(true);
    try {
      const list = await window.ipcRenderer.invoke('fs-list', {
        deviceId,
        platform,
        path,
        bundleId: bundleId || undefined,  // 如果是空字符串，传 undefined
        skipSymlinkResolution: false  // 右侧文件列表需要解析符号链接，显示最终地址
      });

      // 后端将权限受限当作业务结果返回（非数组，避免抛异常引发主进程 stdout 噪音）
      if (list && !Array.isArray(list) && list.permissionDenied) {
        const hint = platform === 'ios'
          ? '该目录受 iOS Sandbox / TCC 保护，即使 root 也无法通过 SSH 直接读取（例如 /.fseventsd、/.Spotlight-V100、/var/db/* 等）。'
          : '该目录被 Android 系统保护，普通 ADB Shell 无法读取。';
        setPermissionError(hint);
        setEntries([]);
        setSelected(null);
        return;
      }

      setEntries(list || []);
      setSelected(null);
    } catch (e: any) {
      const msg = e?.message || '加载目录内容失败';
      // 兼容：万一有历史路径还在走异常分支（例如底层 AFC 直接 throw），仍然做一次识别
      if (isPermissionError(msg)) {
        const hint = platform === 'ios'
          ? '该目录受 iOS Sandbox / TCC 保护，即使 root 也无法通过 SSH 直接读取（例如 /.fseventsd、/.Spotlight-V100、/var/db/* 等）。'
          : '该目录被 Android 系统保护，普通 ADB Shell 无法读取。';
        setPermissionError(hint);
        setEntries([]);
        setSelected(null);
      } else {
        onError(msg);
        setEntries([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadNodeChildren = async (node: TreeNode) => {
    if (!deviceId) return;
    // 对于 iOS，如果没有 bundleId（系统根目录模式），也允许加载
    // if (platform === 'ios' && !bundleId) return;  // 移除这个检查
    
    try {
      // 如果是符号链接且有解析后的路径，使用解析后的路径
      const targetPath = node.resolvedPath || node.path;
      
      const list = await window.ipcRenderer.invoke('fs-list', {
        deviceId,
        platform,
        path: targetPath,
        bundleId: bundleId || undefined,  // 如果是空字符串，传 undefined
        skipSymlinkResolution: false  // 左侧目录树需要解析符号链接，过滤无效的
      });

      // 权限受限：静默返回，让该节点展开为"空"，不影响树的其他分支
      if (list && !Array.isArray(list) && list.permissionDenied) {
        console.warn(`[FileManager] Tree expand permission denied: ${targetPath}`);
        return;
      }

      const dirs = (list || []).filter((e: FileEntry) => e.isDir);
      const children: TreeNode[] = dirs.map((e: FileEntry) => {
        // 特殊处理 .. 父目录
        if (e.name === '..') {
          const parentPath = targetPath.split('/').slice(0, -1).join('/') || '/';
          return {
            name: e.name,
            path: parentPath,
            isDir: true,
            children: [],
            expanded: false,
            loaded: false
          };
        }
        
        return {
          name: e.name,
          path: `${targetPath}/${e.name}`,
          isDir: true,
          children: [],
          expanded: false,
          loaded: false,
          linkTarget: e.linkTarget,
          resolvedPath: e.resolvedPath
        };
      });
      
      return children;
    } catch (e: any) {
      const msg = e?.message || '';
      // 权限受限的子目录静默返回空，避免展开左侧目录树时弹全局错误
      if (isPermissionError(msg)) return [];
      onError(msg || '加载子目录失败');
      return [];
    }
  };

  const toggleNode = async (nodePath: string) => {
    const newExpanded = new Set(expandedPaths);
    
    if (newExpanded.has(nodePath)) {
      newExpanded.delete(nodePath);
    } else {
      newExpanded.add(nodePath);
      
      // 加载子节点
      const updateTree = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        const result: TreeNode[] = [];
        for (const node of nodes) {
          if (node.path === nodePath) {
            if (!node.loaded) {
              const children = await loadNodeChildren(node);
              result.push({ ...node, children, loaded: true, expanded: true });
            } else {
              result.push({ ...node, expanded: true });
            }
          } else {
            if (node.children && node.children.length > 0) {
              const updatedChildren = await updateTree(node.children);
              result.push({ ...node, children: updatedChildren });
            } else {
              result.push(node);
            }
          }
        }
        return result;
      };
      
      const newTree = await updateTree(treeData);
      setTreeData(newTree);
    }
    
    setExpandedPaths(newExpanded);
  };

  const handleNodeClick = (node: TreeNode) => {
    // 如果是符号链接且有解析后的路径，使用解析后的路径
    const targetPath = node.resolvedPath || node.path;
    loadDirectoryContent(targetPath);
  };

  const renderTreeNode = (node: TreeNode, level: number = 0): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedPath === node.path;
    
    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer transition-colors group ${
            isSelected 
              ? (isDark ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-100 text-blue-700')
              : (isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-100 text-slate-600')
          }`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => handleNodeClick(node)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleNode(node.path);
            }}
            className="shrink-0 w-4 h-4 flex items-center justify-center"
          >
            {isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
          
          {/* 文件夹图标，如果是符号链接则添加链接标记 */}
          {node.linkTarget ? (
            <div className="relative inline-block shrink-0">
              {isExpanded ? (
                <FolderOpen size={14} />
              ) : (
                <Folder size={14} />
              )}
              {/* 符号链接标记 */}
              <svg 
                width="6" 
                height="6" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="3" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                className="absolute -bottom-0.5 -right-0.5 text-cyan-500"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
            </div>
          ) : (
            isExpanded ? (
              <FolderOpen size={14} className="shrink-0" />
            ) : (
              <Folder size={14} className="shrink-0" />
            )
          )}
          
          <span className="text-xs font-medium truncate">{node.name}</span>
          
          {/* 显示符号链接目标 */}
          {node.linkTarget && (
            <span className={`text-[9px] font-mono ${isDark ? 'text-cyan-400/50' : 'text-cyan-600/50'} italic truncate ml-1`}>
              → {node.resolvedPath || node.linkTarget}
            </span>
          )}
        </div>
        {isExpanded && node.children && node.children.length > 0 && (
          <div>
            {node.children.map(child => renderTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const handleDownload = async () => {
    if (!selected) return;
    setContextMenu(null);
    
    // 设置进度监听器
    const progressHandler = (_event: any, data: { percent: number; completed: boolean }) => {
      if (data.completed) {
        setDownloadProgress({ percent: 100, fileName: selected });
        setTimeout(() => setDownloadProgress(null), 1000);
      } else {
        setDownloadProgress({ percent: data.percent, fileName: selected });
      }
    };
    
    const removeListener = window.ipcRenderer.on('download-progress', progressHandler);
    
    try {
      // 调用下载，会弹出保存对话框
      const result = await window.ipcRenderer.invoke('fs-download', { 
        deviceId, 
        platform, 
        remotePath: `${selectedPath}/${selected}`, 
        bundleId: bundleId || undefined
      });
      
      // 如果用户取消了保存，result 为 null
      if (result === null) {
        removeListener();
        return;
      }
      
      // 用户已选择保存位置，进度会通过事件更新
    } catch (e: any) {
      onError(e?.message || '下载失败');
      setDownloadProgress(null);
    } finally {
      // 清理监听器
      setTimeout(() => {
        removeListener();
      }, 2000);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setContextMenu(null);
    
    setConfirmDialog({
      title: '确认删除',
      message: `确定要删除 "${selected}" 吗？此操作无法撤销。`,
      onConfirm: async () => {
        try {
          await window.ipcRenderer.invoke('fs-delete', { 
            deviceId, 
            platform, 
            targetPath: `${selectedPath}/${selected}`, 
            bundleId: bundleId || undefined
          });
          setSelected(null);
          loadDirectoryContent(selectedPath);
        } catch (e: any) {
          onError(e?.message || '删除失败');
        }
      }
    });
  };

  const handleUpload = async () => {
    setContextMenu(null);
    
    // 设置进度监听器
    const progressHandler = (_event: any, data: { current: number; total: number; percent: number; fileName: string }) => {
      setUploadProgress({ 
        percent: data.percent, 
        fileName: data.fileName 
      });
    };
    
    const removeListener = window.ipcRenderer.on('upload-progress', progressHandler);
    
    try {
      const result = await window.ipcRenderer.invoke('fs-upload', { 
        deviceId, 
        platform, 
        destPath: selectedPath, 
        bundleId: bundleId || undefined
      });
      
      // 如果用户选择了文件，result.files 会有内容
      if (result && result.files && result.files.length > 0) {
        // 上传完成，显示100%
        setUploadProgress({ 
          percent: 100, 
          fileName: result.files[result.files.length - 1] 
        });
        
        setTimeout(() => {
          setUploadProgress(null);
          loadDirectoryContent(selectedPath);
        }, 500);
      }
    } catch (e: any) {
      onError(e?.message || '上传失败');
      setUploadProgress(null);
    } finally {
      // 清理监听器
      setTimeout(() => {
        removeListener();
      }, 1000);
    }
  };

  const handleMkdir = async () => {
    setContextMenu(null);
    
    setPromptDialog({
      title: '新建文件夹',
      message: '请输入文件夹名称',
      defaultValue: '',
      onSubmit: async (name) => {
        if (!name) return;
        
        try {
          await window.ipcRenderer.invoke('fs-mkdir', { 
            deviceId, 
            platform, 
            dirPath: `${selectedPath}/${name}`, 
            bundleId: bundleId || undefined
          });
          loadDirectoryContent(selectedPath);
        } catch (e: any) {
          onError(e?.message || '新建文件夹失败');
        }
      }
    });
  };

  const openEntry = (entry: FileEntry) => {
    // 处理 .. 父目录
    if (entry.name === '..') {
      const pathParts = selectedPath.split('/').filter(Boolean);
      const parentPath = pathParts.length > 0 ? '/' + pathParts.slice(0, -1).join('/') : '/';
      loadDirectoryContent(parentPath);
      return;
    }
    
    if (entry.isDir) {
      let targetPath: string;
      
      // 如果是符号链接且有解析后的路径，使用解析后的路径
      if (entry.linkTarget && entry.resolvedPath) {
        targetPath = entry.resolvedPath;
      } else if (entry.linkTarget) {
        // 如果有链接目标但没有解析路径，手动解析
        targetPath = entry.linkTarget;
        if (!targetPath.startsWith('/')) {
          const pathParts = selectedPath.split('/').filter(Boolean);
          const targetParts = targetPath.split('/');
          
          for (const part of targetParts) {
            if (part === '..') {
              pathParts.pop();
            } else if (part !== '.') {
              pathParts.push(part);
            }
          }
          targetPath = '/' + pathParts.join('/');
        }
      } else {
        // 普通目录
        targetPath = selectedPath === '/' ? `/${entry.name}` : `${selectedPath}/${entry.name}`;
      }
      
      loadDirectoryContent(targetPath);
    } else {
      setSelected(entry.name);
    }
  };

  // 右键菜单处理
  const handleContextMenu = (e: React.MouseEvent, target: 'file' | 'folder' | 'empty') => {
    e.preventDefault();
    
    const menuWidth = 200;
    const menuHeight = 250;
    
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
    
    setContextMenu({ x, y, target });
  };

  const handleRename = async () => {
    if (!selected) return;
    setContextMenu(null);
    
    setPromptDialog({
      title: '重命名',
      message: '请输入新名称',
      defaultValue: selected,
      onSubmit: async (newName) => {
        if (!newName || newName === selected) return;
        
        try {
          await window.ipcRenderer.invoke('fs-rename', {
            deviceId,
            platform,
            oldPath: `${selectedPath}/${selected}`,
            newPath: `${selectedPath}/${newName}`,
            bundleId: bundleId || undefined
          });
          setSelected(null);
          loadDirectoryContent(selectedPath);
        } catch (e: any) {
          onError(e?.message || '重命名失败');
        }
      }
    });
  };

  const handleCreateFile = async () => {
    setContextMenu(null);
    
    setPromptDialog({
      title: '新建文件',
      message: '请输入文件名称',
      defaultValue: '',
      onSubmit: async (name) => {
        if (!name) return;
        
        try {
          await window.ipcRenderer.invoke('fs-create-file', {
            deviceId,
            platform,
            filePath: `${selectedPath}/${name}`,
            bundleId: bundleId || undefined
          });
          loadDirectoryContent(selectedPath);
        } catch (e: any) {
          onError(e?.message || '新建文件失败');
        }
      }
    });
  };

  const handleInstall = async () => {
    const fileType = selectedFileType;
    
    // 情况1：没有选中文件，直接打开宿主机文件浏览器
    if (!selected) {
      try {
        // 根据平台设置文件过滤器
        const filters = platform === 'android' 
          ? [{ name: 'APK Files', extensions: ['apk'] }]
          : [{ name: 'IPA Files', extensions: ['ipa'] }];
        
        const localFilePath = await window.ipcRenderer.invoke('select-local-file', { filters });
        
        if (!localFilePath) {
          return; // 用户取消选择
        }
        
        // 确定文件类型
        const selectedFileType = localFilePath.toLowerCase().endsWith('.apk') ? 'apk' : 'ipa';
        const fileName = localFilePath.split(/[/\\]/).pop() || 'app';
        
        // 检查平台匹配
        if (platform === 'android' && selectedFileType !== 'apk') {
          onError('Android 设备只能安装 APK 文件');
          return;
        }
        if (platform === 'ios' && selectedFileType !== 'ipa') {
          onError('iOS 设备只能安装 IPA 文件');
          return;
        }
        
        // 显示安装进度
        setInstallProgress({ fileName });
        onError(`正在安装 ${selectedFileType.toUpperCase()} 文件...`);
        
        await window.ipcRenderer.invoke('install-app', {
          deviceId,
          platform,
          filePath: localFilePath,
          fileType: selectedFileType
        });
        
        setInstallProgress(null);
        onError(`安装成功！`);
        setTimeout(() => onError(null), 3000);
        
      } catch (e: any) {
        setInstallProgress(null);
        onError(e?.message || '安装失败');
      }
      return;
    }
    
    // 情况2：已选中文件
    const filePath = `${selectedPath}/${selected}`;
    
    // 检查是否是目录
    const selectedEntry = entries.find(e => e.name === selected);
    const isDirectory = selectedEntry?.isDir || false;
    
    // 如果是目录，或者文件类型不匹配平台，直接打开宿主机文件浏览器
    const isValidInstallFile = 
      !isDirectory && 
      ((platform === 'android' && fileType === 'apk') || 
       (platform === 'ios' && fileType === 'ipa'));
    
    if (!isValidInstallFile) {
      // 直接打开宿主机文件浏览器
      try {
        const filters = platform === 'android' 
          ? [{ name: 'APK Files', extensions: ['apk'] }]
          : [{ name: 'IPA Files', extensions: ['ipa'] }];
        
        const localFilePath = await window.ipcRenderer.invoke('select-local-file', { filters });
        
        if (!localFilePath) {
          return; // 用户取消选择
        }
        
        const selectedFileType = localFilePath.toLowerCase().endsWith('.apk') ? 'apk' : 'ipa';
        const fileName = localFilePath.split(/[/\\]/).pop() || 'app';
        
        setInstallProgress({ fileName });
        onError(`正在安装 ${selectedFileType.toUpperCase()} 文件...`);
        
        await window.ipcRenderer.invoke('install-app', {
          deviceId,
          platform,
          filePath: localFilePath,
          fileType: selectedFileType
        });
        
        setInstallProgress(null);
        onError(`安装成功！`);
        setTimeout(() => onError(null), 3000);
        
      } catch (e: any) {
        setInstallProgress(null);
        onError(e?.message || '安装失败');
      }
      return;
    }
    
    // 情况3：选中的是有效的安装文件，询问用户选择安装方式
    setConfirmDialog({
      title: '选择安装方式',
      message: `请选择如何安装 "${selected}"`,
      confirmText: '安装选中文件',
      onConfirm: async () => {
        // 从设备直接安装
        try {
          setInstallProgress({ fileName: selected });
          onError(`正在从设备安装 ${fileType?.toUpperCase()} 文件...`);
          
          await window.ipcRenderer.invoke('install-app-from-device', {
            deviceId,
            platform,
            devicePath: filePath,
            fileType
          });
          
          setInstallProgress(null);
          onError(`${selected} 安装成功！`);
          setTimeout(() => onError(null), 3000);
          
        } catch (e: any) {
          setInstallProgress(null);
          onError(e?.message || '安装失败');
        }
      },
      secondaryAction: {
        text: '浏览宿主机',
        onAction: async () => {
          // 打开宿主机文件浏览器
          try {
            const filters = platform === 'android' 
              ? [{ name: 'APK Files', extensions: ['apk'] }]
              : [{ name: 'IPA Files', extensions: ['ipa'] }];
            
            const localFilePath = await window.ipcRenderer.invoke('select-local-file', { filters });
            
            if (!localFilePath) {
              return; // 用户取消选择
            }
            
            const selectedFileType = localFilePath.toLowerCase().endsWith('.apk') ? 'apk' : 'ipa';
            const fileName = localFilePath.split(/[/\\]/).pop() || 'app';
            
            setInstallProgress({ fileName });
            onError(`正在安装 ${selectedFileType.toUpperCase()} 文件...`);
            
            await window.ipcRenderer.invoke('install-app', {
              deviceId,
              platform,
              filePath: localFilePath,
              fileType: selectedFileType
            });
            
            setInstallProgress(null);
            onError(`安装成功！`);
            setTimeout(() => onError(null), 3000);
            
          } catch (e: any) {
            setInstallProgress(null);
            onError(e?.message || '安装失败');
          }
        }
      }
    });
  };

  // 右键菜单直接安装（不弹框确认）
  const handleInstallFromContextMenu = async () => {
    if (!selected) return;
    
    setContextMenu(null); // 立即关闭右键菜单
    
    const fileType = selectedFileType;
    const filePath = `${selectedPath}/${selected}`;
    
    // 检查平台和文件类型匹配
    if (platform === 'android' && fileType !== 'apk') {
      onError('Android 设备只能安装 APK 文件');
      return;
    }
    if (platform === 'ios' && fileType !== 'ipa') {
      onError('iOS 设备只能安装 IPA 文件');
      return;
    }
    
    // 从设备直接安装
    try {
      setInstallProgress({ fileName: selected });
      onError(`正在从设备安装 ${fileType?.toUpperCase()} 文件...`);
      
      await window.ipcRenderer.invoke('install-app-from-device', {
        deviceId,
        platform,
        devicePath: filePath,
        fileType
      });
      
      setInstallProgress(null);
      onError(`${selected} 安装成功！`);
      setTimeout(() => onError(null), 3000);
      
    } catch (e: any) {
      setInstallProgress(null);
      onError(e?.message || '安装失败');
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧目录树 */}
      <div className={`w-72 flex flex-col border-r shrink-0 ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
        <div className="p-5 space-y-4 shrink-0">
          <div className="space-y-2">
            <label className={`block text-[10px] font-bold ${isDark ? 'text-zinc-500' : 'text-slate-400'} uppercase tracking-widest`}>当前设备</label>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${isDark ? 'bg-zinc-950 border-zinc-800 text-zinc-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`}>
              <HardDrive size={14} className={isDark ? 'text-zinc-500' : 'text-slate-400'} />
              <span className="text-xs font-medium truncate">
                {deviceId ? (platform === 'android' ? 'Android' : 'iOS') : '未选择设备'}
              </span>
            </div>
            
            {/*
             * iOS 目录说明卡片：
             * - 已识别为越狱 → 不显示任何提示（跟 Android 侧完全一致，直接看目录树即可）
             * - 未识别为越狱 → 保留卡片，因为里面有"我已确认越狱，强制访问根目录 /"的唯一入口
             *   (自动检测偶尔会漏检，用户需要一个手动强制通道)
             */}
            {platform === 'ios' && deviceId && !initializing && treeData.length > 0 && !isJailbroken && (
              <div className={`px-3 py-2 rounded-lg text-[10px] ${
                isDark ? 'bg-blue-900/20 text-blue-400 border border-blue-800/30' : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}>
                <div className="flex items-start gap-2">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <div className="flex-1">
                    <div className="font-bold mb-1">媒体目录</div>
                    <div className="opacity-80 leading-relaxed">
                      当前访问: /var/mobile/Media
                      <br />
                      包含照片、下载、音乐等文件
                    </div>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-current/10 flex flex-col gap-1.5">
                  <button
                    onClick={forceJailbrokenMode}
                    className={`w-full text-[10px] font-semibold px-2 py-1.5 rounded-md transition-all ${
                      isDark
                        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                        : 'bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100'
                    }`}
                    title="跳过自动检测，直接以越狱模式（默认 SSH 22 端口, 密码 alpine）访问根目录"
                  >
                    我已确认越狱，强制访问根目录 /
                  </button>
                  <button
                    onClick={recheckJailbreak}
                    className={`w-full text-[10px] font-medium px-2 py-1.5 rounded-md transition-all ${
                      isDark
                        ? 'bg-transparent border border-current/20 text-current/80 hover:bg-current/5'
                        : 'bg-transparent border border-current/20 text-current/80 hover:bg-current/5'
                    }`}
                    title="清除缓存并重新执行自动检测"
                  >
                    重新检测越狱状态
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 目录树 */}
        <div className={`flex-1 overflow-y-auto custom-scrollbar border-t ${isDark ? 'border-zinc-800' : 'border-slate-200'}`}>
          {initializing ? (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                <div className={`absolute inset-0 flex items-center justify-center ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  </svg>
                </div>
              </div>
              <div className="text-center space-y-2">
                <div className={`text-sm font-bold ${isDark ? 'text-zinc-200' : 'text-slate-800'}`}>
                  正在初始化 iOS 设备
                </div>
                <div className={`text-[10px] ${isDark ? 'text-zinc-500' : 'text-slate-500'} space-y-1`}>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                    <span>检测越狱状态...</span>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse animation-delay-200" />
                    <span>加载文件系统...</span>
                  </div>
                </div>
              </div>
            </div>
          ) : loading && treeData.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 rounded-full border-2 border-blue-500/20 border-t-blue-500 animate-spin" />
            </div>
          ) : treeData.length > 0 ? (
            <div className="py-2">
              {treeData.map(node => renderTreeNode(node))}
            </div>
          ) : (
            <div className={`flex flex-col items-center justify-center h-32 ${isDark ? 'text-zinc-600' : 'text-slate-400'} text-xs`}>
              <Folder size={24} className="mb-2 opacity-30" />
              <span>无可用目录</span>
            </div>
          )}
        </div>

        {/* 底部状态栏 */}
        <div className={`px-4 py-1.5 border-t ${isDark ? 'border-zinc-800 bg-[#181818] text-zinc-400' : 'border-slate-300 bg-white text-slate-600'} text-[10px] flex items-center justify-between shrink-0 h-9`}>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${deviceId ? 'bg-green-500 animate-pulse' : (isDark ? 'bg-zinc-700' : 'bg-slate-200')}`}></div>
            <span className="font-bold tracking-tight uppercase">{treeData.length} 个目录</span>
          </div>
        </div>
      </div>

      {/* 右侧目录详情模块 */}
      <div className={`flex-1 flex flex-col overflow-hidden ${isDark ? 'bg-[#1F1F1F]' : 'bg-[#ffffff]'}`}>
        <div className={`flex items-center justify-between px-6 py-3 border-b shrink-0 ${isDark ? 'bg-[#181818] border-zinc-700/50' : 'bg-[#f8f8f8] border-slate-300'}`}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <Tooltip content="刷新">
                <button
                  onClick={() => loadDirectoryContent(selectedPath)}
                  className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-100 text-slate-500'}`}
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
              </Tooltip>
            </div>
            <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] font-mono truncate ${isDark ? 'bg-[#1F1F1F] border-zinc-700/50 text-zinc-400' : 'bg-[#ffffff] border-slate-300 text-slate-600'}`}>
              <Folder size={14} className="shrink-0 opacity-50" />
              <span className="truncate">{selectedPath || '未选择目录'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-6">
            <Tooltip content="新建文件夹">
              <button
                onClick={handleMkdir}
                disabled={!selectedPath}
                className={`p-2 rounded-lg transition-all ${isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30'}`}
              >
                <FolderPlus size={18} />
              </button>
            </Tooltip>
            <Tooltip content="上传文件">
              <button
                onClick={handleUpload}
                disabled={!selectedPath || !deviceId}
                className={`p-2 rounded-lg transition-all ${isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30'}`}
              >
                <Upload size={18} />
              </button>
            </Tooltip>
            <Tooltip content="下载文件">
              <button
                onClick={handleDownload}
                disabled={!selected}
                className={`p-2 rounded-lg transition-all ${isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30'}`}
              >
                <Download size={18} />
              </button>
            </Tooltip>
            <Tooltip content="安装应用">
              <button
                onClick={handleInstall}
                disabled={!deviceId}
                className={`p-2 rounded-lg transition-all ${isDark ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20 disabled:opacity-30' : 'bg-green-50 text-green-600 hover:bg-green-100 disabled:opacity-30'}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line>
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
              </button>
            </Tooltip>
            <Tooltip content="删除">
              <button
                onClick={handleDelete}
                disabled={!selected}
                className={`p-2 rounded-lg transition-all ${isDark ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-30' : 'bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-30'}`}
              >
                <Trash2 size={18} />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className={`flex-1 overflow-auto custom-scrollbar relative ${entries.length === 0 && !loading ? 'flex flex-col items-center justify-center' : ''}`}
          onContextMenu={(e) => {
            if (!selectedPath) {
              e.preventDefault();
              return;
            }
            handleContextMenu(e, 'empty');
          }}
        >
          {entries.length > 0 || loading ? (
            <table className="w-full border-collapse">
              <thead className={`sticky top-0 z-10 ${isDark ? 'bg-[#181818]' : 'bg-[#f8f8f8]'} backdrop-blur-md border-b ${isDark ? 'border-zinc-700/50' : 'border-slate-300'}`}>
                <tr className={`text-[10px] font-bold uppercase tracking-[0.2em] ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}>
                  <th className="px-6 py-4 text-left w-12">#</th>
                  <th className="px-4 py-4 text-left">名称</th>
                  <th className="px-4 py-4 text-left w-24">类型</th>
                  <th className="px-4 py-4 text-right w-32">大小</th>
                  <th className="px-6 py-4 text-right w-48">修改时间</th>
                </tr>
              </thead>
              <tbody className={`text-xs ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                {selectedPath && selectedPath !== '/' && (
                  <tr
                    onClick={() => {
                      const parts = selectedPath.split('/').filter(Boolean);
                      const parentPath = parts.length > 0 ? '/' + parts.slice(0, -1).join('/') : '/';
                      loadDirectoryContent(parentPath || '/');
                    }}
                    className={`group transition-all cursor-pointer border-b ${isDark ? 'hover:bg-zinc-900/50 border-zinc-700/30' : 'hover:bg-white border-slate-300/50'}`}
                  >
                    <td className="px-6 py-3 text-center">
                      <CornerLeftUp size={15} className={isDark ? 'text-zinc-500' : 'text-slate-400'} />
                    </td>
                    <td className="px-4 py-3 font-medium" colSpan={4}>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>..</span>
                        <span className={`text-[10px] ${isDark ? 'text-zinc-600' : 'text-slate-400'}`}>返回上一目录</span>
                      </div>
                    </td>
                  </tr>
                )}
                {entries.filter(e => e.name !== '..').map((e) => (
                  <tr 
                    key={e.name}
                    onClick={() => setSelected(e.name)}
                    onDoubleClick={() => openEntry(e)}
                    onContextMenu={(ev) => {
                      ev.stopPropagation();
                      setSelected(e.name);
                      handleContextMenu(ev, e.isDir ? 'folder' : 'file');
                    }}
                    className={`group transition-all cursor-pointer ${
                      selected === e.name 
                        ? (isDark ? 'bg-blue-600/10' : 'bg-blue-50/50') 
                        : (isDark ? 'hover:bg-zinc-900/50' : 'hover:bg-white')
                    } border-b ${isDark ? 'border-zinc-700/30' : 'border-slate-300/50'}`}
                  >
                    <td className="px-6 py-3.5 text-center">
                      {e.linkTarget ? (
                        // 符号链接：根据目标类型显示图标
                        <div className="relative inline-block">
                          {e.linkTargetIsDir ? (
                            <Folder size={16} className="text-blue-500" />
                          ) : (
                            <File size={16} className={isDark ? 'text-zinc-500' : 'text-slate-400'} />
                          )}
                          {/* 符号链接标记 */}
                          <svg 
                            width="8" 
                            height="8" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="3" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                            className="absolute -bottom-0.5 -right-0.5 text-cyan-500"
                          >
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                          </svg>
                        </div>
                      ) : (
                        // 普通文件/文件夹
                        e.isDir ? (
                          <Folder size={16} className="text-blue-500" />
                        ) : (
                          <File size={16} className={isDark ? 'text-zinc-500' : 'text-slate-400'} />
                        )
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-md">{e.name}</span>
                        {e.linkTarget && (
                          <span className={`text-[10px] font-mono ${isDark ? 'text-cyan-400/60' : 'text-cyan-600/60'} italic flex items-center gap-1`}>
                            <span>→</span>
                            <span className="truncate max-w-xs" title={e.resolvedPath || e.linkTarget}>
                              {e.resolvedPath && e.resolvedPath !== e.linkTarget ? e.resolvedPath : e.linkTarget}
                            </span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`px-4 py-3.5 text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-zinc-600' : 'text-slate-400'}`}>
                      {e.linkTarget ? (
                        <span className="flex items-center gap-1">
                          {e.linkTargetIsDir ? 'Link→Dir' : 'Link→File'}
                        </span>
                      ) : (
                        e.isDir ? 'Dir' : 'File'
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right text-[11px] font-mono opacity-60">
                      {e.isDir ? '-' : e.size}
                    </td>
                    <td className="px-6 py-3.5 text-right text-[11px] font-mono opacity-60">
                      {e.mtime || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : !loading && permissionError ? (
            <div className="flex flex-col items-center justify-center gap-5 px-8 animate-in fade-in zoom-in-95 duration-500">
              <div className={`p-8 rounded-3xl ${isDark ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-amber-50 border border-amber-200 shadow-sm'}`}>
                <Lock size={48} strokeWidth={1.2} className={isDark ? 'text-amber-400' : 'text-amber-600'} />
              </div>
              <div className="space-y-2 text-center max-w-md">
                <p className={`text-sm font-bold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                  无权限访问该目录
                </p>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                  {permissionError}
                </p>
                <p className={`text-[10px] font-mono mt-3 ${isDark ? 'text-zinc-600' : 'text-slate-400'}`}>
                  {selectedPath}
                </p>
                <p className={`text-[10px] mt-4 ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}>
                  {platform === 'ios'
                    ? '提示：iOS 越狱设备下部分系统目录仍受 Sandbox/TCC 限制，即使 root 也无法读取，属正常现象'
                    : '提示：此目录受 Android 系统保护，需 root 或 debug 版系统才能访问'}
                </p>
              </div>
            </div>
          ) : !loading && (
            <div className="flex flex-col items-center justify-center gap-5 opacity-30 animate-in fade-in zoom-in-95 duration-500">
              <div className={`p-8 rounded-3xl ${isDark ? 'bg-[#181818]' : 'bg-white border border-slate-300 shadow-sm'}`}>
                <Folder size={48} strokeWidth={1} />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]">
                  {!selectedPath ? '请选择目录' : '目录为空'}
                </p>
                <p className="text-[10px] font-medium opacity-60">
                  {!selectedPath ? '在左侧目录树中选择一个目录' : '当前路径下没有任何文件'}
                </p>
              </div>
            </div>
          )}
          
          {loading && (
            <div className="absolute inset-0 bg-black/5 flex items-center justify-center backdrop-blur-[1px] z-20">
               <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-blue-500">正在加载...</span>
               </div>
            </div>
          )}
        </div>

        {/* 底部状态栏 */}
        <div className={`h-9 px-6 flex items-center justify-between border-t text-[10px] font-bold shrink-0 ${isDark ? 'bg-[#181818] border-zinc-800 text-zinc-400' : 'bg-white border-slate-300 text-slate-600'}`}>
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${selectedPath ? 'bg-green-500' : 'bg-zinc-700'}`} />
                <span className="uppercase tracking-widest">找到 {entries.length} 个项目</span>
             </div>
             {selected && !uploadProgress && !downloadProgress && !installProgress && (
               <div className="flex items-center gap-2 text-blue-500">
                  <div className="w-1 h-1 rounded-full bg-blue-500" />
                  <span>选中: {selected}</span>
               </div>
             )}
             {uploadProgress && (
               <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-green-500">
                    <div className="w-3 h-3 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
                    <span>上传: {uploadProgress.fileName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-32 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                      <div 
                        className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-300"
                        style={{ width: `${uploadProgress.percent}%` }}
                      />
                    </div>
                    <span className="text-green-500 font-mono">{uploadProgress.percent}%</span>
                  </div>
               </div>
             )}
             {downloadProgress && (
               <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-blue-500">
                    <div className="w-3 h-3 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                    <span>下载: {downloadProgress.fileName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-32 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                      <div 
                        className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
                        style={{ width: `${downloadProgress.percent}%` }}
                      />
                    </div>
                    <span className="text-blue-500 font-mono">{downloadProgress.percent}%</span>
                  </div>
               </div>
             )}
             {installProgress && (
               <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-purple-500">
                    <div className="w-3 h-3 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                    <span>安装: {installProgress.fileName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-32 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                      <div className="h-full bg-gradient-to-r from-purple-500 to-purple-400 animate-pulse" style={{ width: '100%' }} />
                    </div>
                    <span className="text-purple-500">安装中...</span>
                  </div>
               </div>
             )}
          </div>
          <div className="flex items-center gap-4">
             {deviceId && <span className="uppercase tracking-widest">平台: {platform.toUpperCase()}</span>}
          </div>
        </div>
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className={`fixed z-50 ${isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-slate-300'} border rounded-lg shadow-xl py-1 min-w-[200px]`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.target === 'file' && (
            <>
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
                onClick={handleDownload}
              >
                <Download size={14} />
                下载
              </button>
              {isInstallableFile && (
                <button
                  className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-green-400' : 'hover:bg-slate-100 text-green-600'} flex items-center gap-2`}
                  onClick={handleInstallFromContextMenu}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line>
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                  </svg>
                  安装 {selectedFileType?.toUpperCase()}
                </button>
              )}
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
                onClick={handleRename}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
                重命名
              </button>
              <div className={`h-px ${isDark ? 'bg-zinc-700' : 'bg-slate-200'} my-1`} />
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-red-400' : 'hover:bg-slate-100 text-red-600'} flex items-center gap-2`}
                onClick={handleDelete}
              >
                <Trash2 size={14} />
                删除
              </button>
            </>
          )}
          
          {contextMenu.target === 'folder' && (
            <>
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
                onClick={() => {
                  if (selected) {
                    const entry = entries.find(e => e.name === selected);
                    if (entry) openEntry(entry);
                  }
                  setContextMenu(null);
                }}
              >
                <FolderOpen size={14} />
                打开
              </button>
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
                onClick={handleDownload}
              >
                <Download size={14} />
                下载
              </button>
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
                onClick={handleRename}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
                重命名
              </button>
              <div className={`h-px ${isDark ? 'bg-zinc-700' : 'bg-slate-200'} my-1`} />
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-red-400' : 'hover:bg-slate-100 text-red-600'} flex items-center gap-2`}
                onClick={handleDelete}
              >
                <Trash2 size={14} />
                删除
              </button>
            </>
          )}
          
          {contextMenu.target === 'empty' && (
            <>
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
                onClick={handleUpload}
              >
                <Upload size={14} />
                上传文件
              </button>
              <div className={`h-px ${isDark ? 'bg-zinc-700' : 'bg-slate-200'} my-1`} />
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
                onClick={handleCreateFile}
              >
                <File size={14} />
                新建文件
              </button>
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
                onClick={handleMkdir}
              >
                <FolderPlus size={14} />
                新建文件夹
              </button>
              <div className={`h-px ${isDark ? 'bg-zinc-700' : 'bg-slate-200'} my-1`} />
              <button
                className={`w-full px-4 py-2 text-left text-xs ${isDark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-slate-100 text-slate-900'} flex items-center gap-2`}
                onClick={() => {
                  loadDirectoryContent(selectedPath);
                  setContextMenu(null);
                }}
              >
                <RefreshCw size={14} />
                刷新
              </button>
            </>
          )}
        </div>
      )}

      {/* 自定义输入对话框 */}
      {promptDialog && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-200"
          onClick={() => setPromptDialog(null)}
        >
          <div 
            className={`w-96 rounded-2xl shadow-2xl border overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 ${
              isDark ? 'bg-zinc-900 border-zinc-700/50' : 'bg-white border-slate-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`px-6 py-4 ${isDark ? 'bg-zinc-950/50' : 'bg-slate-50'}`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 ${isDark ? 'text-zinc-400' : 'text-slate-600'}`}>
                  {promptDialog.title.includes('重命名') ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                    </svg>
                  ) : promptDialog.title.includes('文件夹') ? (
                    <FolderPlus size={18} />
                  ) : (
                    <File size={18} />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className={`text-base font-bold tracking-tight ${isDark ? 'text-zinc-100' : 'text-slate-900'}`}>
                    {promptDialog.title}
                  </h3>
                  <p className={`text-xs mt-1 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                    {promptDialog.message}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4">
              <input
                type="text"
                autoFocus
                defaultValue={promptDialog.defaultValue}
                placeholder="请输入..."
                className={`w-full px-3 py-2.5 text-sm rounded-lg border-2 outline-none transition-all ${
                  isDark 
                    ? 'bg-zinc-950 border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:bg-zinc-900' 
                    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white'
                }`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const value = e.currentTarget.value.trim();
                    setPromptDialog(null);
                    if (value) promptDialog.onSubmit(value);
                  } else if (e.key === 'Escape') {
                    setPromptDialog(null);
                  }
                }}
              />
            </div>
            
            <div className={`px-6 py-3 flex items-center justify-between border-t ${
              isDark ? 'border-zinc-800/50 bg-zinc-950/50' : 'border-slate-200 bg-slate-50'
            }`}>
              <div className={`flex items-center gap-2 text-[10px] font-medium ${isDark ? 'text-zinc-600' : 'text-slate-400'}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <span>按 <kbd className={`px-1 rounded font-mono ${isDark ? 'bg-zinc-800' : 'bg-slate-200'}`}>Esc</kbd> 取消</span>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPromptDialog(null)}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    isDark 
                      ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 active:scale-95' 
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 active:scale-95'
                  }`}
                >
                  取消
                </button>
                <button
                  onClick={(e) => {
                    const input = e.currentTarget.parentElement?.parentElement?.parentElement?.querySelector('input');
                    const value = input?.value.trim();
                    setPromptDialog(null);
                    if (value) promptDialog.onSubmit(value);
                  }}
                  className="relative px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 transition-all duration-200 active:scale-95 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30"
                >
                  <span className="relative z-10">确定</span>
                  <div className="absolute inset-0 rounded-lg bg-white/20 opacity-0 hover:opacity-100 transition-opacity" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 确认删除对话框 */}
      {confirmDialog && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-200"
          onClick={() => setConfirmDialog(null)}
        >
          <div 
            className={`w-96 rounded-2xl shadow-2xl border overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 ${
              isDark ? 'bg-zinc-900 border-zinc-700/50' : 'bg-white border-slate-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`px-6 py-4 ${isDark ? 'bg-zinc-950/50' : 'bg-slate-50'}`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className={`text-base font-bold tracking-tight ${isDark ? 'text-zinc-100' : 'text-slate-900'}`}>
                    {confirmDialog.title}
                  </h3>
                  <p className={`text-xs mt-1 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                    {confirmDialog.message}
                  </p>
                </div>
              </div>
            </div>
            
            <div className={`px-6 py-3 flex items-center justify-end gap-2 border-t ${
              isDark ? 'border-zinc-800/50 bg-zinc-950/50' : 'border-slate-200 bg-slate-50'
            }`}>
              <button
                onClick={() => setConfirmDialog(null)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  isDark 
                    ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 active:scale-95' 
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 active:scale-95'
                }`}
              >
                取消
              </button>
              {confirmDialog.secondaryAction && (
                <button
                  onClick={() => {
                    confirmDialog.secondaryAction!.onAction();
                    setConfirmDialog(null);
                  }}
                  className="relative px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 transition-all duration-200 active:scale-95 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30"
                >
                  <span className="relative z-10">{confirmDialog.secondaryAction.text}</span>
                  <div className="absolute inset-0 rounded-lg bg-white/20 opacity-0 hover:opacity-100 transition-opacity" />
                </button>
              )}
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className={`relative px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 active:scale-95 ${
                  confirmDialog.secondaryAction
                    ? 'bg-gradient-to-r from-green-600 to-green-500 text-white hover:from-green-500 hover:to-green-400 shadow-lg shadow-green-500/25 hover:shadow-xl hover:shadow-green-500/30'
                    : 'bg-gradient-to-r from-red-600 to-red-500 text-white hover:from-red-500 hover:to-red-400 shadow-lg shadow-red-500/25 hover:shadow-xl hover:shadow-red-500/30'
                }`}
              >
                <span className="relative z-10">{confirmDialog.confirmText || '确定删除'}</span>
                <div className="absolute inset-0 rounded-lg bg-white/20 opacity-0 hover:opacity-100 transition-opacity" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

