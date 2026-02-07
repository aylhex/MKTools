#!/bin/bash

echo "=========================================="
echo "Frida 修复验证脚本 V2"
echo "=========================================="

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试计数
PASSED=0
FAILED=0

# 测试函数
test_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

test_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

test_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

echo ""
echo "[1/5] 检查 Frida 环境..."
if command -v frida &> /dev/null; then
    FRIDA_VERSION=$(frida --version)
    test_pass "Frida 已安装: v${FRIDA_VERSION}"
else
    test_fail "Frida 未安装"
fi

echo ""
echo "[2/5] 检查 Android 设备..."
if command -v adb &> /dev/null; then
    ANDROID_DEVICES=$(adb devices | grep -v "List" | grep "device$" | wc -l | tr -d ' ')
    if [ "$ANDROID_DEVICES" -gt 0 ]; then
        test_pass "检测到 $ANDROID_DEVICES 个 Android 设备"
        
        # 测试 Frida Server
        DEVICE_ID=$(adb devices | grep -v "List" | grep "device$" | head -1 | awk '{print $1}')
        echo "  测试设备: $DEVICE_ID"
        
        # 检查 Frida Server 进程
        FRIDA_RUNNING=$(adb -s "$DEVICE_ID" shell "ps -A | grep frida-server" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$FRIDA_RUNNING" -gt 0 ]; then
            test_pass "Frida Server 正在运行"
            
            # 测试连接
            if timeout 5 frida-ps -D "$DEVICE_ID" &> /dev/null; then
                test_pass "主机可以连接到 Frida Server"
            else
                test_warn "Frida Server 运行但连接失败"
            fi
        else
            test_warn "Frida Server 未运行（应用会自动启动）"
        fi
    else
        test_warn "未检测到 Android 设备"
    fi
else
    test_fail "ADB 未安装"
fi

echo ""
echo "[3/5] 检查 iOS 设备..."
if command -v idevice_id &> /dev/null; then
    IOS_DEVICES=$(idevice_id -l 2>/dev/null | wc -l | tr -d ' ')
    if [ "$IOS_DEVICES" -gt 0 ]; then
        test_pass "检测到 $IOS_DEVICES 个 iOS 设备"
        
        # 检查 SSH
        if nc -z localhost 2222 2>/dev/null; then
            test_pass "iproxy 正在运行（端口 2222）"
        else
            test_warn "iproxy 未运行（iOS 功能需要）"
        fi
    else
        test_warn "未检测到 iOS 设备"
    fi
else
    test_warn "libimobiledevice 未安装"
fi

echo ""
echo "[4/5] 检查缓存目录..."
CACHE_DIR="$HOME/.mktools/icon-cache"
if [ -d "$CACHE_DIR" ]; then
    CACHE_COUNT=$(ls -1 "$CACHE_DIR" 2>/dev/null | wc -l | tr -d ' ')
    CACHE_SIZE=$(du -sh "$CACHE_DIR" 2>/dev/null | awk '{print $1}')
    test_pass "缓存目录存在"
    echo "  位置: $CACHE_DIR"
    echo "  图标数: $CACHE_COUNT"
    echo "  大小: $CACHE_SIZE"
else
    test_warn "缓存目录不存在（首次运行时会创建）"
fi

echo ""
echo "[5/5] 检查代码编译..."
if npx tsc --noEmit 2>&1 | grep -q "error"; then
    test_fail "TypeScript 编译失败"
else
    test_pass "TypeScript 编译通过"
fi

echo ""
echo "=========================================="
echo "测试结果"
echo "=========================================="
echo -e "${GREEN}通过: $PASSED${NC}"
echo -e "${RED}失败: $FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ 所有测试通过！${NC}"
    echo ""
    echo "下一步："
    echo "1. 运行应用: npm run dev"
    echo "2. 选择设备并进入应用脱壳模块"
    echo "3. 验证以下功能："
    echo "   - Frida 状态显示正常（不卡死）"
    echo "   - 应用名称正确显示（不是包名）"
    echo "   - 应用图标正常显示"
    echo "   - 缓存功能正常工作"
    exit 0
else
    echo ""
    echo -e "${RED}✗ 有 $FAILED 个测试失败${NC}"
    echo ""
    echo "请检查失败的项目并修复后重试"
    exit 1
fi
