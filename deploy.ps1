# ==============================================================================
# Infinite Trading - Windows PowerShell Deployment Script
# Targets Hostinger VPS: 187.127.122.111
# ==============================================================================

param (
    [string]$VpsIp = "2.29.43.245",
    [string]$VpsUser = "root",
    [string]$RemoteDir = "/var/www/infinitetrading"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Infinite Trading - Upload to Hostinger VPS ($VpsIp)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$CurrentDir = Get-Location

# 1. Prepare temporary deployment archive to keep transfer fast and lightweight
$Timestamp = Get-Date -Format "yyyyMMddHHmmss"
$ArchiveName = "deploy_$Timestamp.zip"
$TempArchive = Join-Path $env:TEMP $ArchiveName

Write-Host ">>> [1/4] Packaging project files (excluding node_modules & .git)..." -ForegroundColor Yellow

$FilesToInclude = Get-ChildItem -Path $CurrentDir -Exclude "node_modules", ".git", "*.zip", "*.tmp"

# Create a temporary directory for packaging
$TempPackDir = Join-Path $env:TEMP "it_pack_$Timestamp"
New-Item -ItemType Directory -Path $TempPackDir -Force | Out-Null

try {
    foreach ($item in $FilesToInclude) {
        Copy-Item -Path $item.FullName -Destination $TempPackDir -Recurse -Force
    }

    # Compress package
    Compress-Archive -Path "$TempPackDir\*" -DestinationPath $TempArchive -Force

    Write-Host ">>> [2/3] Uploading archive ($([math]::Round((Get-Item $TempArchive).Length / 1MB, 2)) MB) to VPS..." -ForegroundColor Yellow
    
    # Upload archive directly via SCP to /tmp
    $RemoteDest = "${VpsUser}@${VpsIp}:/tmp/$ArchiveName"
    scp "$TempArchive" $RemoteDest

    Write-Host ">>> [3/3] Extracting and running deployment on VPS..." -ForegroundColor Yellow
    $RemoteCommands = @"
mkdir -p $RemoteDir
apt-get install -y unzip
unzip -o /tmp/$ArchiveName -d $RemoteDir || true
rm -f /tmp/$ArchiveName
sed -i 's/\r$//' $RemoteDir/deploy-vps.sh
chmod +x $RemoteDir/deploy-vps.sh
cd $RemoteDir
bash $RemoteDir/deploy-vps.sh
"@

    ssh -t "${VpsUser}@${VpsIp}" "$RemoteCommands"

    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  Deployment finished successfully!" -ForegroundColor Green
    Write-Host "  Visit your site at: http://infinitetrading.site" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green

} finally {
    # Cleanup local temp files
    if (Test-Path $TempArchive) { Remove-Item $TempArchive -Force -ErrorAction SilentlyContinue }
    if (Test-Path $TempPackDir) { Remove-Item $TempPackDir -Recurse -Force -ErrorAction SilentlyContinue }
}
