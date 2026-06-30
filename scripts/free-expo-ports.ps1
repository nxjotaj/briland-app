$ports = 8081, 8082, 19000, 19001, 19002
$connections = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue
$ownerIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique

foreach ($ownerId in $ownerIds) {
  if ($ownerId) {
    Stop-Process -Id $ownerId -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Milliseconds 500
$remaining = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue

if ($remaining) {
  Write-Host "Ainda existem processos usando portas do Expo:"
  $remaining | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table
  exit 1
}

Write-Host "Portas do Expo liberadas."
