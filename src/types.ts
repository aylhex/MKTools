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
