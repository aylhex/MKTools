# Windows Libimobiledevice Bundler Script
# 此脚本用于从 Scoop 安装目录复制 libimobiledevice 工具及依赖到 resources/bin/win

$TargetDir = "$PSScriptRoot\..\resources\bin\win"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

Write-Host "Target Directory: $TargetDir"

# 尝试查找 Scoop 安装路径
$ScoopApps = "$env:USERPROFILE\scoop\apps"
$LibimobiledeviceDir = "$ScoopApps\libimobiledevice\current\bin"

if (-not (Test-Path $LibimobiledeviceDir)) {
    Write-Host "Warning: Scoop libimobiledevice installation not found at $LibimobiledeviceDir"
    Write-Host "Please install it using: scoop install libimobiledevice"
    Write-Host "Or manually download binaries and place them in resources/bin/win"
    exit 1
}

Write-Host "Found libimobiledevice at: $LibimobiledeviceDir"

# 需要复制的工具
$Tools = @("idevice_id.exe", "ideviceinfo.exe", "idevicesyslog.exe")

# 复制工具和所有 DLL
# Windows 上通常同一个 bin 目录下的 dll 都是需要的，简单起见全部复制
# 或者只复制 .exe 和 .dll

Get-ChildItem -Path $LibimobiledeviceDir | Where-Object { 
    ($_.Extension -eq ".dll") -or ($_.Name -in $Tools)
} | ForEach-Object {
    Write-Host "Copying $($_.Name)..."
    Copy-Item -Path $_.FullName -Destination $TargetDir -Force
}

Write-Host "Done! Files copied to $TargetDir"
Write-Host "Please verify that the following files exist:"
foreach ($tool in $Tools) {
    if (Test-Path "$TargetDir\$tool") {
        Write-Host "  [OK] $tool"
    } else {
        Write-Host "  [MISSING] $tool"
    }
}
