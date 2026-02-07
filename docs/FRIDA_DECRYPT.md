# 应用脱壳模块使用说明

## 功能概述

应用脱壳模块使用 Frida 动态插桩技术，可以对 Android 和 iOS 应用进行脱壳操作，提取加密的应用包。

## 前置要求

### 1. 安装 Frida 工具

在主机上安装 Frida 命令行工具：

```bash
pip install frida-tools
```

验证安装：

```bash
frida --version
```

### 2. Frida Server 部署

#### Android 设备

应用会自动检测并部署 Frida Server：

- 支持的架构：arm, arm64
- Frida Server 文件位置：`resources/bin/frida/frida-server-16.2.1-android-*`
- 自动推送到设备：`/data/local/tmp/frida-server`
- 自动启动服务

#### iOS 设备

需要越狱设备，应用会自动部署：

- 支持的架构：arm, arm64
- Frida deb 包位置：`resources/bin/frida/frida_16.2.1_iphoneos-*.deb`
- 通过 SSH 自动安装（需要设备已越狱并配置 SSH）

## 使用流程

### 1. 连接设备

在主界面选择目标设备（Android 或 iOS）

### 2. 进入脱壳模块

点击顶部导航栏的"应用脱壳"标签

### 3. 查看 Frida 状态

左侧面板顶部会显示 Frida 状态指示器：

- 🟢 **Frida 已就绪**：可以进行脱壳操作
- 🔵 **正在检查 Frida...**：正在连接 Frida Server
- 🟡 **Frida 未就绪**：连接失败，需要检查配置
- ⚪ **Frida 状态未知**：未连接设备

### 4. 选择应用

- 应用列表会自动加载设备上的第三方应用
- 使用搜索框快速查找目标应用
- 应用图标和名称通过 Frida 自动获取

### 5. 开始脱壳

1. 点击目标应用
2. 在弹出的对话框中查看应用信息
3. 确认 Frida 状态为"已就绪"
4. 点击"开始脱壳"按钮
5. 在右侧控制台查看实时日志

### 6. 获取结果

脱壳完成后，输出文件会保存在：

- **默认路径**：`/tmp/mktools_decrypt/`
- **文件命名**：`{bundleId}_{timestamp}_decrypted.{ipa|apk}`

## 脱壳方法

### Android 应用

1. **Frida DEX Dump**（推荐）
   - 使用 `frida-dexdump` 工具
   - 动态提取内存中的 DEX 文件
   - 支持加壳应用

2. **基础 APK 提取**（备用）
   - 直接从设备拉取 APK
   - 适用于未加壳应用

### iOS 应用

使用 `frida-ios-dump` 工具：

- 自动注入目标应用
- 提取解密后的可执行文件
- 重新打包为 IPA

## 故障排除

### Frida 未就绪

**可能原因：**

1. Frida 工具未安装
   ```bash
   pip install frida-tools
   ```

2. Frida Server 未运行
   - Android：检查 `/data/local/tmp/frida-server` 是否存在
   - iOS：检查是否已安装 Frida deb 包

3. 设备连接问题
   - Android：确保 ADB 连接正常
   - iOS：确保设备已越狱且 SSH 可用

### 脱壳失败

**常见问题：**

1. **应用未运行**
   - 某些脱壳方法需要应用在前台运行
   - 手动启动目标应用后重试

2. **权限不足**
   - Android：确保设备已 root
   - iOS：确保设备已越狱

3. **应用保护机制**
   - 某些应用有反调试保护
   - 尝试使用不同的脱壳方法

### 日志分析

右侧控制台会显示详细的操作日志：

- `[Init]`：初始化阶段
- `[Step X/5]`：当前步骤
- `[✓]`：操作成功
- `[Error]`：错误信息
- `[Warn]`：警告信息

## 技术细节

### Frida 资源路径

开发模式：
```
resources/bin/frida/
```

打包模式：
```
{app.resourcesPath}/bin/frida/
```

### 支持的 Frida 版本

- Frida Server: 16.2.1
- 兼容 Frida Tools: 12.x - 16.x

### 网络要求

- Android：通过 ADB 连接（USB 或 TCP）
- iOS：通过 USB 连接 + SSH（端口 2222）

## 安全提示

⚠️ **重要提醒：**

1. 仅用于合法的安全研究和逆向工程
2. 不要用于破解商业软件
3. 遵守当地法律法规
4. 尊重软件版权

## 相关资源

- [Frida 官方文档](https://frida.re/docs/)
- [frida-ios-dump](https://github.com/AloneMonkey/frida-ios-dump)
- [frida-dexdump](https://github.com/hluwa/frida-dexdump)

## 更新日志

### v1.0.0
- ✅ 自动检测和部署 Frida Server
- ✅ 支持 Android 和 iOS 平台
- ✅ 实时日志输出
- ✅ Frida 状态监控
- ✅ 应用图标和信息获取
