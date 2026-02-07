# Frida 脱壳示例

## 快速开始

### 1. 环境准备

```bash
# 安装 Frida 工具
pip install frida-tools

# 验证安装
frida --version

# 运行环境检测脚本
bash scripts/test-frida.sh
```

### 2. Android 应用脱壳示例

#### 场景：脱壳微信应用

1. **连接 Android 设备**
   ```bash
   adb devices
   ```

2. **在 MKTools 中操作**
   - 选择 Android 设备
   - 进入"应用脱壳"模块
   - 等待 Frida 状态显示"已就绪"
   - 搜索"微信"或"com.tencent.mm"
   - 点击应用，确认信息
   - 点击"开始脱壳"

3. **查看日志输出**
   ```
   [Init] 开始脱壳应用: com.tencent.mm
   [Step 1/5] 检查 Frida 工具...
   [✓] Frida 工具已安装
   [Step 2/5] 检查并部署 Frida Server...
   [Frida] Checking Android Frida Server...
   [Frida] Frida Server started successfully.
   [✓] Frida Server 已就绪
   [Step 3/5] 准备输出目录...
   [✓] 输出目录: /tmp/mktools_decrypt
   [Step 4/5] 开始脱壳进程...
   [Android] 连接到应用进程...
   [Android] 使用 frida-dexdump 提取 DEX...
   [✓] Android 应用脱壳完成
   [✓] 输出文件: /tmp/mktools_decrypt/com.tencent.mm_2026-02-05_decrypted.apk
   ```

4. **获取结果**
   ```bash
   ls -lh /tmp/mktools_decrypt/
   ```

### 3. iOS 应用脱壳示例

#### 场景：脱壳 Safari 应用

**前提条件：**
- iOS 设备已越狱
- 已安装 OpenSSH
- 可以通过 USB 连接

1. **验证 SSH 连接**
   ```bash
   # 检查 iproxy 是否运行
   ps aux | grep iproxy
   
   # 测试 SSH 连接
   ssh -p 2222 root@localhost
   ```

2. **在 MKTools 中操作**
   - 选择 iOS 设备
   - 进入"应用脱壳"模块
   - 等待 Frida 状态显示"已就绪"
   - 搜索目标应用
   - 点击应用，确认信息
   - 点击"开始脱壳"

3. **查看日志输出**
   ```
   [Init] 开始脱壳应用: com.apple.mobilesafari
   [Step 1/5] 检查 Frida 工具...
   [✓] Frida 工具已安装
   [Step 2/5] 检查并部署 Frida Server...
   [Frida] Checking iOS Frida connection...
   [Frida] Device is accessible via SSH. Preparing to deploy Frida...
   [Frida] Installation complete. Waiting for service...
   [Frida] Frida Server started successfully.
   [✓] Frida Server 已就绪
   [Step 3/5] 准备输出目录...
   [✓] 输出目录: /tmp/mktools_decrypt
   [Step 4/5] 开始脱壳进程...
   [iOS] 使用 frida-ios-dump 进行脱壳...
   [iOS] 目标应用: com.apple.mobilesafari
   [iOS] Dumping...
   [✓] iOS 应用脱壳完成
   [✓] 输出文件: /tmp/mktools_decrypt/com.apple.mobilesafari_2026-02-05_decrypted.ipa
   ```

## 高级用法

### 自定义输出目录

通过修改 `electron/services/fridaService.ts` 中的 `DecryptOptions`：

```typescript
const options: DecryptOptions = {
  deviceId: 'your-device-id',
  platform: 'android',
  bundleId: 'com.example.app',
  outputDir: '/custom/output/path'  // 自定义输出路径
};
```

### 手动部署 Frida Server

#### Android

```bash
# 推送 Frida Server
adb push resources/bin/frida/frida-server-16.2.1-android-arm64 /data/local/tmp/frida-server

# 设置权限
adb shell "chmod 755 /data/local/tmp/frida-server"

# 启动服务
adb shell "/data/local/tmp/frida-server -D"

# 验证
frida-ps -U
```

#### iOS

```bash
# 通过 SSH 安装
scp -P 2222 resources/bin/frida/frida_16.2.1_iphoneos-arm64.deb root@localhost:/tmp/

ssh -p 2222 root@localhost "dpkg -i /tmp/frida_16.2.1_iphoneos-arm64.deb"

# 验证
frida-ps -U
```

### 使用 Frida 脚本

#### 获取应用信息

```javascript
// 创建脚本 get-app-info.js
Java.perform(function() {
    var context = Java.use('android.app.ActivityThread')
        .currentApplication()
        .getApplicationContext();
    
    var pm = context.getPackageManager();
    var packageName = context.getPackageName();
    var packageInfo = pm.getPackageInfo(packageName, 0);
    
    console.log('Package Name:', packageName);
    console.log('Version Name:', packageInfo.versionName.value);
    console.log('Version Code:', packageInfo.versionCode.value);
});
```

运行脚本：
```bash
frida -U -n com.example.app -l get-app-info.js
```

#### 提取应用图标

```javascript
// 创建脚本 get-app-icon.js
Java.perform(function() {
    var context = Java.use('android.app.ActivityThread')
        .currentApplication()
        .getApplicationContext();
    
    var pm = context.getPackageManager();
    var appInfo = context.getApplicationInfo();
    var drawable = appInfo.loadIcon(pm);
    
    // 转换为 Bitmap
    var Bitmap = Java.use('android.graphics.Bitmap');
    var Canvas = Java.use('android.graphics.Canvas');
    
    var bitmap = Bitmap.createBitmap(
        drawable.getIntrinsicWidth(),
        drawable.getIntrinsicHeight(),
        Bitmap.Config.ARGB_8888.value
    );
    
    var canvas = Canvas.$new(bitmap);
    drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
    drawable.draw(canvas);
    
    // 保存为 PNG
    var FileOutputStream = Java.use('java.io.FileOutputStream');
    var CompressFormat = Java.use('android.graphics.Bitmap$CompressFormat');
    
    var file = FileOutputStream.$new('/sdcard/icon.png');
    bitmap.compress(CompressFormat.PNG.value, 100, file);
    file.close();
    
    console.log('Icon saved to /sdcard/icon.png');
});
```

## 常见问题

### Q1: Frida Server 启动失败

**A:** 检查设备权限和架构匹配

```bash
# Android - 检查架构
adb shell getprop ro.product.cpu.abi

# 确保使用正确的 Frida Server 版本
# arm64-v8a -> frida-server-16.2.1-android-arm64
# armeabi-v7a -> frida-server-16.2.1-android-arm
```

### Q2: iOS 设备无法连接

**A:** 检查 SSH 和 iproxy 配置

```bash
# 启动 iproxy
iproxy 2222 22 &

# 测试连接
ssh -p 2222 root@localhost

# 默认密码通常是 'alpine'
```

### Q3: 脱壳后的应用无法安装

**A:** 需要重新签名

```bash
# Android
# 使用 MKTools 的"应用重签名"模块

# iOS
# 使用 iOS App Signer 或 MKTools 的重签名功能
```

### Q4: 内存不足错误

**A:** 增加 Node.js 内存限制

```bash
# 在 package.json 中修改启动脚本
"dev": "NODE_OPTIONS='--max-old-space-size=4096' vite"
```

## 性能优化

### 批量脱壳

```typescript
// 示例：批量脱壳多个应用
const apps = ['com.app1', 'com.app2', 'com.app3'];

for (const bundleId of apps) {
  try {
    await decryptApp({
      deviceId,
      platform: 'android',
      bundleId
    }, console.log);
  } catch (e) {
    console.error(`Failed to decrypt ${bundleId}:`, e);
  }
}
```

### 并行处理

```typescript
// 并行脱壳（谨慎使用，可能导致设备过载）
const promises = apps.map(bundleId => 
  decryptApp({
    deviceId,
    platform: 'android',
    bundleId
  }, console.log)
);

await Promise.allSettled(promises);
```

## 调试技巧

### 启用详细日志

```bash
# 设置 Frida 日志级别
export FRIDA_LOG_LEVEL=debug

# 运行应用
npm run dev
```

### 监控 Frida 进程

```bash
# Android
adb shell "ps -A | grep frida"

# iOS
ssh -p 2222 root@localhost "ps aux | grep frida"
```

### 查看 Frida 端口

```bash
# 默认端口 27042
netstat -an | grep 27042
```

## 参考资源

- [Frida 官方文档](https://frida.re/docs/home/)
- [Frida JavaScript API](https://frida.re/docs/javascript-api/)
- [frida-ios-dump GitHub](https://github.com/AloneMonkey/frida-ios-dump)
- [frida-dexdump GitHub](https://github.com/hluwa/frida-dexdump)
- [Android 逆向工程](https://github.com/android-reverse-engineering)
