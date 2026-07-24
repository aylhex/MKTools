#!/bin/bash
# ensure-frida-prebuild.sh
# 目的：确保 frida 的 native binding 是按当前项目 Electron 版本编译/下载的 prebuild。
#
# 背景：
#   - frida@16.2.5 提供 electron-v118 的 prebuilt binary（对应 Electron 27.x, modules 118）
#   - 但 `npm install` 默认按当前 Node 版本找 prebuild（例如 Node 24 → node-v133），
#     16.x 里没有这个版本，就会回退到源码编译 —— 需要 meson/ninja/Xcode，几乎必定失败。
#   - 解决：postinstall 时强制以 electron@27.3.11 的 headers 拉 prebuild。
#
# 触发时机：npm install / npm ci 之后自动运行；也可以手动 `npm run rebuild-frida`

set -e

FRIDA_NATIVE="node_modules/frida/build/frida_binding.node"

# 已经存在合适大小的 .node 就跳过（避免每次 install 都重新下载 75MB）
if [ -f "$FRIDA_NATIVE" ]; then
  size=$(stat -f%z "$FRIDA_NATIVE" 2>/dev/null || stat -c%s "$FRIDA_NATIVE" 2>/dev/null || echo 0)
  # 合法的 frida binding 至少 50MB；小于说明是异常残留
  if [ "$size" -gt 50000000 ]; then
    echo "[ensure-frida-prebuild] ✓ frida binding OK (size=${size} bytes)"
    exit 0
  fi
fi

echo "[ensure-frida-prebuild] frida binding not found or invalid, rebuilding with Electron target..."

# 强制以 Electron 27 的 headers 拉 electron-v118 prebuild
export npm_config_runtime=electron
export npm_config_target=27.3.11
export npm_config_disturl=https://electronjs.org/headers

# `npm rebuild` 会重新触发 frida 包的 install.js（scripts/install.js），
# 该脚本会尝试从 https://github.com/frida/frida/releases 下载 prebuilt binary
npm rebuild frida

if [ -f "$FRIDA_NATIVE" ]; then
  echo "[ensure-frida-prebuild] ✓ frida binding installed successfully"
else
  echo "[ensure-frida-prebuild] ✗ frida binding install failed; please try manually:"
  echo "  npm run rebuild-frida"
  exit 1
fi
