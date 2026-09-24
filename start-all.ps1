# ReachInbox Scheduler - Startup Script
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logsDir = Join-Path $baseDir "logs"
if (!(Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

Write-Host "Starting ReachInbox Scheduler services..." -ForegroundColor Cyan

# 1. Redis
$redisPort = Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue
if (!$redisPort) {
  Write-Host "Starting Redis on port 6379..." -ForegroundColor Yellow
  $cmd = 'cmd.exe /c ""C:\Users\Admin\redis\Redis-8.10.1-Windows-x64-msys2\redis-server.exe" > ..\logs\redis.log 2>&1"'
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = "C:\Users\Admin\redis\Redis-8.10.1-Windows-x64-msys2"
  } | Out-Null
  Start-Sleep -Seconds 2
} else {
  Write-Host "Redis already running on port 6379" -ForegroundColor Green
}

# 2. Backend API
$apiPort = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
if (!$apiPort) {
  Write-Host "Starting Express API on port 4000..." -ForegroundColor Yellow
  $cmd = 'cmd.exe /c ""C:\Program Files\nodejs\node.exe" dist\index.js > ..\logs\backend.log 2>&1"'
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = (Join-Path $baseDir "backend")
  } | Out-Null
  Start-Sleep -Seconds 2
} else {
  Write-Host "Backend API already running on port 4000" -ForegroundColor Green
}

# 3. Worker
$workerProc = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*dist\queue\worker.js*" }
if (!$workerProc) {
  Write-Host "Starting BullMQ Worker..." -ForegroundColor Yellow
  $cmd = 'cmd.exe /c ""C:\Program Files\nodejs\node.exe" dist\queue\worker.js > ..\logs\worker.log 2>&1"'
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = (Join-Path $baseDir "backend")
  } | Out-Null
  Start-Sleep -Seconds 2
} else {
  Write-Host "BullMQ Worker already active" -ForegroundColor Green
}

# 4. Frontend UI
$fePort = Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue
if (!$fePort) {
  Write-Host "Starting Frontend UI on port 5174..." -ForegroundColor Yellow
  $cmd = 'cmd.exe /c "npx vite --port 5174 > ..\logs\frontend.log 2>&1"'
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = (Join-Path $baseDir "frontend")
  } | Out-Null
  Start-Sleep -Seconds 3
} else {
  Write-Host "Frontend UI already running on port 5174" -ForegroundColor Green
}

Write-Host "`nAll Services Ready:" -ForegroundColor Cyan
Write-Host "  Frontend Dashboard : http://localhost:5174" -ForegroundColor Green
Write-Host "  Backend Root Page  : http://localhost:4000" -ForegroundColor Green
Write-Host "  Bull Board Queues  : http://localhost:4000/admin/queues" -ForegroundColor Green
Write-Host "  API Health Check   : http://localhost:4000/health" -ForegroundColor Green
