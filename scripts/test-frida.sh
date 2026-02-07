#!/bin/bash

# Frida 功能测试脚本

echo "=========================================="
echo "Frida 环境检测"
echo "=========================================="

# 1. 检查 Frida 是否安装
echo ""
echo "[1/4] 检查 Frida 工具..."
if command -v frida &> /dev/null; then
    FRIDA_VERSION=$(frida --version)
    echo "✓ Frida 已安装: v${FRIDA_VERSION}"
else
    echo "✗ Frida 未安装"
    echo "请运行: pip install frida-tools"
    exit 1
fi

# 2. 检查 Python
echo ""
echo "[2/4] 检查 Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "✓ ${PYTHON_VERSION}"
else
    echo "✗ Python3 未安装"
    exit 1
fi

# 3. 检查 Frida 资源文件
echo ""
echo "[3/4] 检查 Frida 资源文件..."
FRIDA_DIR="resources/bin/frida"

if [ -d "$FRIDA_DIR" ]; then
    echo "✓ Frida 资源目录存在"
    
    # Android
    if ls $FRIDA_DIR/frida-server-*-android-* 1> /dev/null 2>&1; then
        echo "  ✓ Android Frida Server 文件存在"
        ls -lh $FRIDA_DIR/frida-server-*-android-* | awk '{print "    -", $9, "(" $5 ")"}'
    else
        echo "  ✗ Android Frida Server 文件缺失"
    fi
    
    # iOS
    if ls $FRIDA_DIR/frida_*_iphoneos-*.deb 1> /dev/null 2>&1; then
        echo "  ✓ iOS Frida deb 文件存在"
        ls -lh $FRIDA_DIR/frida_*_iphoneos-*.deb | awk '{print "    -", $9, "(" $5 ")"}'
    else
        echo "  ✗ iOS Frida deb 文件缺失"
    fi
    
    # frida-ios-dump
    if [ -f "$FRIDA_DIR/frida-ios-dump/dump.py" ]; then
        echo "  ✓ frida-ios-dump 脚本存在"
    else
        echo "  ✗ frida-ios-dump 脚本缺失"
    fi
    
    # frida-dexdump
    if [ -d "$FRIDA_DIR/frida-dexdump" ]; then
        echo "  ✓ frida-dexdump 工具存在"
    else
        echo "  ✗ frida-dexdump 工具缺失"
    fi
else
    echo "✗ Frida 资源目录不存在: $FRIDA_DIR"
    exit 1
fi

# 4. 检查设备连接
echo ""
echo "[4/4] 检查设备连接..."

# Android 设备
if command -v adb &> /dev/null; then
    ANDROID_DEVICES=$(adb devices | grep -v "List" | grep "device$" | wc -l | tr -d ' ')
    if [ "$ANDROID_DEVICES" -gt 0 ]; then
        echo "✓ 检测到 $ANDROID_DEVICES 个 Android 设备"
        adb devices -l | grep "device$" | while read line; do
            echo "    - $line"
        done
    else
        echo "○ 未检测到 Android 设备"
    fi
else
    echo "○ ADB 未安装"
fi

# iOS 设备
if command -v idevice_id &> /dev/null; then
    IOS_DEVICES=$(idevice_id -l 2>/dev/null | wc -l | tr -d ' ')
    if [ "$IOS_DEVICES" -gt 0 ]; then
        echo "✓ 检测到 $IOS_DEVICES 个 iOS 设备"
        idevice_id -l 2>/dev/null | while read udid; do
            NAME=$(ideviceinfo -u "$udid" -k DeviceName 2>/dev/null || echo "Unknown")
            echo "    - $NAME ($udid)"
        done
    else
        echo "○ 未检测到 iOS 设备"
    fi
else
    echo "○ libimobiledevice 未安装"
fi

echo ""
echo "=========================================="
echo "测试完成"
echo "=========================================="
