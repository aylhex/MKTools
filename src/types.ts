export interface LogEntry {
  id: number;
  timestamp: string;
  pid: number;
  tid: number;
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
  tag: string;
  msg: string;
}

export interface Device {
  id: string;
  name: string;
  platform: 'android' | 'ios';
  status: string;
}

export interface FilterState {
  level: string; // 'V', 'D', 'I', ...
  tag: string;
  pid: string;
  search: string;
  package?: string; // Android 按应用包名过滤
}

// ==================== iOS Console 风格过滤器 ====================
// 参考 macOS Console.app：顶部搜索栏 + 一串结构化过滤 chip；chip 之间为 AND 关系。

/** 可参与匹配的字段：any = 综合搜索（tag+msg+pid） */
export type IosFilterField = 'any' | 'process' | 'pid' | 'message' | 'type';

/** 匹配操作符 */
export type IosFilterOp =
  | 'contains'      // 包含（大小写不敏感）
  | 'notContains'   // 不包含
  | 'equals'        // 完全相等
  | 'notEquals'     // 不等
  | 'startsWith'    // 以…开头
  | 'endsWith'      // 以…结尾
  | 'regex';        // 正则匹配

export interface IosFilter {
  id: string;
  field: IosFilterField;
  op: IosFilterOp;
  value: string;
  disabled?: boolean;
}

/** 类别快速切换：对应 Console.app 顶部的 "Any / Info / Debug / Errors and Faults" */
export type IosLogCategory = 'any' | 'info' | 'debug' | 'errors';

export interface IosFilterState {
  category: IosLogCategory;
  filters: IosFilter[];
}

export type Theme = 'light' | 'dark';

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime?: string;
  permissions?: string;
  linkTarget?: string;
  linkTargetIsDir?: boolean;
  resolvedPath?: string;
}

export interface KeystoreInfo {
  aliases: string[];
}

export interface SignResult {
  success: boolean;
  message: string;
  outputPath?: string;
}

export interface IosIdentity {
  name: string;
}

export interface AppInfo {
  packageName: string;
  name: string;
  version: string;
  icon?: string;
}
