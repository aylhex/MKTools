declare module 'appium-ios-device' {
  export namespace services {
    function startHouseArrestService(deviceId: string): Promise<HouseArrestService>;
    function startInstallationProxyService(deviceId: string): Promise<InstallationProxyService>;
    function startAfcService(deviceId: string): Promise<AfcService>;
  }

  export namespace utilities {
    function getConnectedDevices(): Promise<DeviceInfo[]>;
  }

  interface DeviceInfo {
    udid: string;
    connectionType?: string;
  }

  interface HouseArrestService {
    vendContainer(bundleId: string): Promise<AfcService>;
  }

  interface InstallationProxyService {
    listApplications(options?: { applicationType?: string }): Promise<Record<string, ApplicationInfo>>;
    close(): void;
  }

  interface ApplicationInfo {
    CFBundleDisplayName?: string;
    CFBundleName?: string;
    CFBundleIdentifier?: string;
    [key: string]: any;
  }

  interface AfcService {
    listDirectory(path: string): Promise<string[]>;
    getFileInfo(path: string): Promise<FileInfo>;
    createReadStream(path: string): Promise<NodeJS.ReadableStream>;
    createWriteStream(path: string): Promise<NodeJS.WritableStream>;
    deleteFile(path: string): Promise<void>;
    deleteDirectory(path: string): Promise<void>;
    createDirectory(path: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    close(): void;
  }

  interface FileInfo {
    st_ifmt: string;
    st_size?: string;
    st_mtime?: string;
  }
}
