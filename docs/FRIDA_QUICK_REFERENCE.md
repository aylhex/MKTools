# Frida 脱壳模块 - 快速参考

## 一分钟快速开始

```bash
# 1. 安装 Frida
pip install frida-tools

# 2. 验证安装
frida --version

# 3. 连接设备
adb devices  # Android
idevice_id -l  # iOS

# 4. 启动 MKTools
npm run dev

# 5. 使用脱壳功能
# - 选择设备
# - 进入"应用脱壳"标签
# - 等待 Frida 状态变为"已就绪"
# - 选择应用并点击"开始脱壳"
```

## 状态指示器

| 颜色 | 状态 | 说明 |
|------|------|------|
| 🟢 绿色 | Frida 已就绪 | 可以进行脱壳操作 |
| 🔵 蓝色 | 正在检查... | 正在连接 Frida Server |
| 🟡 黄色 | Frida 未就绪 | 连接失败，需要检查配置 |
| ⚪ 灰色 | 状态未知 | 未连接设备 |

## 常用命令

### Frida 基础

```bash
# 查看版本
frida --version

# 列出设备
frida-ls-devices

# 列出进程
frida-ps -U  # USB 设备
frida-ps -D <device-id>  # 指定设备

# 附加到进程
frida -U -n <package-name>
frida -D <device-id> -n <package-name>
```

### Android

```bash
# 检查架构
adb shell getprop ro.product.cpu.abi

# 推送 Frida Server
adb push frida-server /data/local/tmp/

# 启动 Frida Server
adb shell "/data/local/tmp/frida-server -D"

# 检查进程
adb shell "ps -A | grep frida"
```

### iOS

```bash
# 启动 iproxy
iproxy 2222 22 &

# SSH 连接
ssh -p 2222 root@localhost

# 安装 Frida
dpkg -i frida_16.2.1_iphoneos-arm64.deb

# 检查进程
ps aux | grep frida
```

## 文件路径

| 项目 | 路径 |
|------|------|
| Frida 资源 | `resources/bin/frida/` |
| Android Server | `resources/bin/frida/frida-server-16.2.1-android-*` |
| iOS deb | `resources/bin/frida/frida_16.2.1_iphoneos-*.deb` |
| iOS dump 脚本 | `resources/bin/frida/frida-ios-dump/dump.py` |
| 输出目录 | `/tmp/mktools_decrypt/` |

## 故障排除速查

| 问题 | 解决方案 |
|------|----------|
| Frida 未安装 | `pip install frida-tools` |
| Server 未启动 | 检查设备连接，重新部署 |
| 权限不足 | Android: root 设备<br>iOS: 越狱设备 |
| 连接超时 | 检查 USB 连接，重启 ADB/iproxy |
| 脱壳失败 | 查看日志，确认应用正在运行 |

## 日志级别

| 前缀 | 含义 |
|------|------|
| `[Init]` | 初始化阶段 |
| `[Step X/5]` | 当前步骤 |
| `[✓]` | 操作成功 |
| `[Error]` | 错误信息 |
| `[Warn]` | 警告信息 |
| `[Info]` | 提示信息 |
| `[Frida]` | Frida 相关日志 |
| `[Android]` | Android 特定日志 |
| `[iOS]` | iOS 特定日志 |

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + F` | 搜索应用 |
| `Cmd/Ctrl + K` | 清空日志 |
| `Cmd/Ctrl + R` | 刷新应用列表 |
| `Esc` | 关闭对话框 |

## API 参考

### IPC 调用

```typescript
// 获取应用列表（带 Frida 增强）
const apps = await window.ipcRenderer.invoke('fetch-frida-app-list', {
  deviceId: string,
  platform: 'android' | 'ios'
});

// 执行脱壳
const result = await window.ipcRenderer.invoke('decrypt-app', {
  deviceId: string,
  platform: 'android' | 'ios',
  bundleId: string
});

// 监听日志
window.ipcRenderer.on('decrypt-log', (event, msg) => {
  console.log(msg);
});
```

### 服务函数

```typescript
// 检查 Frida 安装
await checkFridaInstalled(): Promise<boolean>

// 部署 Frida Server
await checkAndDeployFridaServer(
  deviceId: string,
  platform: 'android' | 'ios',
  onLog: (msg: string) => void
): Promise<boolean>

// 获取应用列表
await fetchAppListViaFrida(
  deviceId: string,
  platform: 'android' | 'ios',
  onLog?: (msg: string) => void
): Promise<FridaAppInfo[]>

// 脱壳应用
await decryptApp(
  options: DecryptOptions,
  onLog: (msg: string) => void
): Promise<string>
```

## 环境变量

```bash
# Frida 日志级别
export FRIDA_LOG_LEVEL=debug

# Node.js 内存限制
export NODE_OPTIONS='--max-old-space-size=4096'
```

## 支持的平台

| 平台 | 架构 | 状态 |
|------|------|------|
| Android | arm | ✅ |
| Android | arm64 | ✅ |
| Android | x86 | ⚠️ 未测试 |
| Android | x86_64 | ⚠️ 未测试 |
| iOS | arm | ✅ |
| iOS | arm64 | ✅ |

## 相关链接

- [完整文档](./FRIDA_DECRYPT.md)
- [使用示例](./FRIDA_EXAMPLES.md)
- [实现总结](../FRIDA_MODULE_SUMMARY.md)
- [Frida 官网](https://frida.re/)

## 版本信息

- **Frida Server**: 16.2.1
- **模块版本**: 1.0.0
- **最后更新**: 2026-02-05

---

💡 **提示**: 使用 `bash scripts/test-frida.sh` 快速检测环境配置
  