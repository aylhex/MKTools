#!/bin/bash

# 项目根目录（脚本自身所在目录的上一级）
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🧹 清除 macOS 应用缓存..."
echo "   项目路径: $PROJECT_ROOT"
echo ""

# 1. 完全退出所有 Electron 进程
echo "1️⃣ 停止所有 Electron 进程..."
pkill -9 -f "Electron" 2>/dev/null
pkill -9 -f "electron" 2>/dev/null
sleep 1
echo "   ✅ 已停止"

# 1.5 阻止 Spotlight 索引项目目录（否则 node_modules 里的 Electron.app 改名副本、
#    以及 dist_build 里的中间产物都会被启动器/Spotlight 搜索到，出现重复应用）
echo "1️⃣.5 阻止 Spotlight 索引项目目录..."
# .metadata_never_index：macOS 官方约定，放此空文件会跳过整个目录的 Spotlight 索引
touch "$PROJECT_ROOT/.metadata_never_index"
# 已被索引的立即清除（部分 macOS 版本 mdutil 需要 sudo）
mdutil -Eai "$PROJECT_ROOT" 2>/dev/null || sudo mdutil -Eai "$PROJECT_ROOT" 2>/dev/null
echo "   ✅ Spotlight 已排除项目目录（node_modules / dist_build 里的 .app 不会再被搜到）"

# 2. 清除 Launch Services 数据库
echo "2️⃣ 清除 Launch Services 数据库..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user
sleep 1
echo "   ✅ 已清除"

# 3. 清除图标缓存
echo "3️⃣ 清除图标缓存..."
sudo rm -rf /Library/Caches/com.apple.iconservices.store
rm -rf ~/Library/Caches/com.apple.iconservices.store
sleep 1
echo "   ✅ 已清除"

# 4. 清除应用状态缓存
echo "4️⃣ 清除应用状态缓存..."
rm -rf ~/Library/Saved\ Application\ State/com.github.Electron.savedState 2>/dev/null
rm -rf ~/Library/Saved\ Application\ State/com.electron.*.savedState 2>/dev/null
echo "   ✅ 已清除"

# 5. 重启 Dock
echo "5️⃣ 重启 Dock..."
killall Dock
sleep 2
echo "   ✅ Dock 已重启"

# 6. 重启 Finder（可选）
echo "6️⃣ 重启 Finder..."
killall Finder
sleep 1
echo "   ✅ Finder 已重启"

echo ""
echo "✅ 缓存清除完成！"
echo ""
echo "📝 下一步："
echo "   1. 等待 5 秒让系统稳定"
echo "   2. 运行: npm run dev"
echo "   3. 检查 Dock 悬浮提示"
echo ""

# 等待 5 秒
for i in {5..1}; do
  echo "   等待 $i 秒..."
  sleep 1
done

echo ""
echo "🚀 现在可以启动应用了！"
