#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const buildDir = path.join(__dirname, '../build');
const iconPath = path.join(buildDir, 'icon.png');

console.log('🎨 开始生成应用图标...\n');

// 检查源图标是否存在
if (!fs.existsSync(iconPath)) {
  console.error('❌ 错误: build/icon.png 不存在');
  process.exit(1);
}

// 1. 生成 macOS .icns 格式
console.log('📱 生成 macOS .icns 格式...');
const iconsetDir = path.join(buildDir, 'AppIcon.iconset');

if (!fs.existsSync(iconsetDir)) {
  fs.mkdirSync(iconsetDir, { recursive: true });
}

const iconSizes = [
  { size: 16, name: 'icon_16x16.png' },
  { size: 32, name: 'icon_16x16@2x.png' },
  { size: 32, name: 'icon_32x32.png' },
  { size: 64, name: 'icon_32x32@2x.png' },
  { size: 128, name: 'icon_128x128.png' },
  { size: 256, name: 'icon_128x128@2x.png' },
  { size: 256, name: 'icon_256x256.png' },
  { size: 512, name: 'icon_256x256@2x.png' },
  { size: 512, name: 'icon_512x512.png' },
  { size: 1024, name: 'icon_512x512@2x.png' }
];

iconSizes.forEach(({ size, name }) => {
  const outputPath = path.join(iconsetDir, name);
  try {
    execSync(`sips -z ${size} ${size} "${iconPath}" --out "${outputPath}"`, { stdio: 'pipe' });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ 生成 ${name} 失败`);
  }
});

// 使用 iconutil 生成 .icns
try {
  const icnsPath = path.join(buildDir, 'icon.icns');
  execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'pipe' });
  console.log('  ✓ icon.icns 生成成功\n');
} catch (e) {
  console.error('  ✗ 生成 icon.icns 失败\n');
}

// 2. 生成 Windows .ico 格式
console.log('🪟 生成 Windows .ico 格式...');
console.log('  ℹ️  macOS 原生不支持生成 .ico 文件');
console.log('  ℹ️  请使用以下方法之一：\n');
console.log('  方法 1: 安装 ImageMagick');
console.log('    brew install imagemagick');
console.log('    magick convert build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico\n');
console.log('  方法 2: 使用在线工具');
console.log('    https://convertio.co/png-ico/');
console.log('    https://www.icoconverter.com/\n');
console.log('  方法 3: 使用 Windows 系统生成\n');

// 清理临时文件
console.log('🧹 清理临时文件...');
try {
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  console.log('  ✓ 清理完成\n');
} catch (e) {
  console.log('  ⚠️  清理失败（可以手动删除 build/AppIcon.iconset）\n');
}

console.log('✅ 图标生成完成！');
console.log('\n生成的文件:');
console.log('  • build/icon.icns (macOS)');
console.log('  • build/icon.png (Linux)');
console.log('  • build/icon.ico (需要手动生成)');
