#!/bin/bash

ELECTRON_DIR="node_modules/electron/dist"
ELECTRON_APP="$ELECTRON_DIR/Electron.app"
MKTOOLS_APP="$ELECTRON_DIR/MKTools.app"
PATH_TXT="node_modules/electron/path.txt"
PROJECT_ICON="build/icon.icns"

echo "🔧 开始修补 Electron 应用名称和图标..."

# 1. 重命名 .app 包
if [ -d "$ELECTRON_APP" ]; then
    echo "📦 将 Electron.app 重命名为 MKTools.app..."
    mv "$ELECTRON_APP" "$MKTOOLS_APP"
elif [ -d "$MKTOOLS_APP" ]; then
    echo "✅ MKTools.app 已存在"
else
    echo "❌ 找不到 Electron.app 或 MKTools.app"
    exit 1
fi

INFO_PLIST="$MKTOOLS_APP/Contents/Info.plist"

# 2. 重命名可执行文件
if [ -f "$MKTOOLS_APP/Contents/MacOS/Electron" ]; then
    echo "📄 重命名可执行文件..."
    mv "$MKTOOLS_APP/Contents/MacOS/Electron" "$MKTOOLS_APP/Contents/MacOS/MKTools"
fi

# 3. 更新 Info.plist
echo "📝 更新 Info.plist..."
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable MKTools" "$INFO_PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string MKTools" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName MKTools" "$INFO_PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName MKTools" "$INFO_PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.mktools.app" "$INFO_PLIST" 2>/dev/null

# 4. 替换应用图标
if [ -f "$PROJECT_ICON" ]; then
    echo "🖼️  替换应用图标..."
    cp "$PROJECT_ICON" "$MKTOOLS_APP/Contents/Resources/electron.icns"
else
    echo "⚠️  未找到项目图标: $PROJECT_ICON"
fi

# 5. 删除本地化目录
echo "🗑️  移除本地化目录..."
find "$MKTOOLS_APP/Contents/Resources" -name "*.lproj" -type d -exec rm -rf {} +

# 6. 更新 path.txt
echo "🔗 更新 electron/path.txt..."
printf "MKTools.app/Contents/MacOS/MKTools" > "$PATH_TXT"

# 验证修改
BUNDLE_EXEC=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$INFO_PLIST")
echo "✅ CFBundleExecutable: $BUNDLE_EXEC"

echo "🧹 清除 macOS 缓存..."
# 停止所有 Electron 进程
pkill -9 -f "Electron" 2>/dev/null
pkill -9 -f "MKTools" 2>/dev/null

# 注册新的应用路径
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$MKTOOLS_APP"

# 强制刷新应用包的时间戳
touch "$MKTOOLS_APP"

# 重启 Dock (可选，有时候不需要，但为了保险起见)
killall Dock 2>/dev/null

echo "✅ 完成！现在启动开发服务器应该显示 MKTools 及其图标。"
echo "注意：如果 Dock 上仍有旧图标，请将其移除并重新添加。"
