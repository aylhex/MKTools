const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// 生成不同尺寸的 PNG 文件
const sizes = [16, 32, 48, 64, 128, 256];
const iconsetDir = path.join(__dirname, '../build/ico-temp');

// 创建临时目录
if (!fs.existsSync(iconsetDir)) {
  fs.mkdirSync(iconsetDir, { recursive: true });
}

console.log('生成不同尺寸的图标...');
sizes.forEach(size => {
  const outputPath = path.join(iconsetDir, `icon_${size}.png`);
  execSync(`sips -z ${size} ${size} build/icon.png --out ${outputPath}`, { stdio: 'inherit' });
});

console.log('\n所有尺寸已生成。');
console.log('\n由于 macOS 原生不支持生成 .ico 文件，请使用以下方法之一：');
console.log('1. 安装 ImageMagick: brew install imagemagick');
console.log('   然后运行: magick convert build/ico-temp/icon_*.png build/icon.ico');
console.log('\n2. 使用在线工具: https://convertio.co/png-ico/');
console.log('   上传 build/icon.png 并下载 .ico 文件');
console.log('\n3. 使用 Windows 系统生成 .ico 文件');
console.log('\n临时 PNG 文件已保存在: build/ico-temp/');
