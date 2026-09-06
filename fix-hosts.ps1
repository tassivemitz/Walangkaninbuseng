# Fix local Windows hosts file
$HostsPath = "$env:windir\System32\drivers\etc\hosts"

$Script = @"
`$lines = Get-Content '$HostsPath' | Where-Object { `$_ -notmatch 'infinitetrading' }
`$lines | Set-Content '$HostsPath'
Add-Content -Path '$HostsPath' -Value '187.127.122.111 infinitetrading.site'
Add-Content -Path '$HostsPath' -Value '187.127.122.111 www.infinitetrading.site'
ipconfig /flushdns
Write-Host 'Hosts file updated successfully!' -ForegroundColor Green
Start-Sleep -Seconds 2
"@

Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -Command `"$Script`""
