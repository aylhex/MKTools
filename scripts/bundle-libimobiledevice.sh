#!/bin/bash

# 设置目标目录
TARGET_DIR="resources/bin/mac"
mkdir -p "$TARGET_DIR"

# 需要打包的工具列表
TOOLS=("idevice_id" "ideviceinfo" "idevicesyslog")

# 查找工具路径 (假设通过 brew 安装)
for TOOL in "${TOOLS[@]}"; do
    TOOL_PATH=$(which $TOOL)
    if [ -z "$TOOL_PATH" ]; then
        echo "Error: $TOOL not found. Please install it first using 'brew install libimobiledevice'"
        continue
    fi
    
    echo "Copying $TOOL from $TOOL_PATH..."
    cp "$TOOL_PATH" "$TARGET_DIR/"
    
    # 获取依赖库
    echo "Resolving dependencies for $TOOL..."
    otool -L "$TOOL_PATH" | grep -v "/usr/lib" | grep -v "/System/Library" | grep -v ":" | awk '{print $1}' | while read -r LIB; do
        # 处理 @rpath
        if [[ "$LIB" == @rpath* ]]; then
            # 尝试在工具同级目录或 ../lib 下查找
            REAL_LIB_NAME=$(basename "$LIB")
            # 这是一个简化的假设，实际上 rpath 解析很复杂
            # 这里我们尝试从 brew 的安装目录中查找
            BREW_PREFIX=$(brew --prefix)
            POSSIBLE_LIB=$(find "$BREW_PREFIX/lib" -name "$REAL_LIB_NAME" | head -n 1)
            
            if [ -n "$POSSIBLE_LIB" ]; then
                echo "  -> Found dependency: $POSSIBLE_LIB"
                cp -n "$POSSIBLE_LIB" "$TARGET_DIR/"
                chmod +w "$TARGET_DIR/$REAL_LIB_NAME"
            else
                echo "  -> Warning: Could not resolve $LIB"
            fi
        elif [ -f "$LIB" ]; then
            echo "  -> Copying dependency: $LIB"
            cp -n "$LIB" "$TARGET_DIR/"
            LIB_NAME=$(basename "$LIB")
            chmod +w "$TARGET_DIR/$LIB_NAME"
        fi
    done
done

# 递归检查已拷贝库的依赖
# 这里做一个简单的二级依赖检查，可能不够完美但通常够用
echo "Checking secondary dependencies..."
for DYLIB in "$TARGET_DIR"/*.dylib; do
    if [ -f "$DYLIB" ]; then
        otool -L "$DYLIB" | grep -v "/usr/lib" | grep -v "/System/Library" | grep -v ":" | grep -v "$(basename "$DYLIB")" | awk '{print $1}' | while read -r LIB; do
             if [[ "$LIB" == @rpath* ]]; then
                REAL_LIB_NAME=$(basename "$LIB")
                if [ ! -f "$TARGET_DIR/$REAL_LIB_NAME" ]; then
                    BREW_PREFIX=$(brew --prefix)
                    POSSIBLE_LIB=$(find "$BREW_PREFIX/lib" -name "$REAL_LIB_NAME" | head -n 1)
                    if [ -n "$POSSIBLE_LIB" ]; then
                        echo "  -> Found secondary dependency: $POSSIBLE_LIB"
                        cp -n "$POSSIBLE_LIB" "$TARGET_DIR/"
                    fi
                fi
             elif [ -f "$LIB" ]; then
                LIB_NAME=$(basename "$LIB")
                if [ ! -f "$TARGET_DIR/$LIB_NAME" ]; then
                    echo "  -> Copying secondary dependency: $LIB"
                    cp -n "$LIB" "$TARGET_DIR/"
                fi
             fi
        done
    fi
done

echo "Done! All files are in $TARGET_DIR"
echo "Note: This is a basic script. You might still need to manually copy some missing dylibs if runtime errors occur."
