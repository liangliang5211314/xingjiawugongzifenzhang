param(
  [string]$CommitMessage = "",
  [ValidateSet("full", "push-only", "server-only", "restart-only")]
  [string]$Mode = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverHost = "root@39.103.57.77"
$serverPath = "/www/wwwroot/xingjiawugongzi"
$branch = "main"
$pm2Name = "xingjiawugongzi"

function Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Done($message) {
  Write-Host $message -ForegroundColor Green
}

function Warn($message) {
  Write-Host $message -ForegroundColor Yellow
}

function Ask-Mode() {
  Write-Host ""
  Write-Host "Select deploy mode:" -ForegroundColor Cyan
  Write-Host "1. Full deploy (commit + push + server pull + install + restart)"
  Write-Host "2. Push only (commit + push)"
  Write-Host "3. Server only (git pull + npm install + pm2 restart)"
  Write-Host "4. Restart only (pm2 restart)"
  $choice = Read-Host "Enter 1 / 2 / 3 / 4, default is 1"

  switch ($choice) {
    "2" { return "push-only" }
    "3" { return "server-only" }
    "4" { return "restart-only" }
    default { return "full" }
  }
}

function Invoke-RemoteScript([string]$remoteScript) {
  ssh $serverHost $remoteScript
}

function Ensure-GitRepo() {
  $inside = git rev-parse --is-inside-work-tree 2>$null
  if ($LASTEXITCODE -ne 0 -or $inside -ne "true") {
    throw "Current directory is not a Git repository: $projectRoot"
  }
}

function Commit-And-Push() {
  Step "Checking local Git workspace"
  $status = git status --short

  if (-not $status) {
    Warn "No local changes found."
  } else {
    git status
    if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
      $script:CommitMessage = Read-Host "Enter commit message"
    }
    if ([string]::IsNullOrWhiteSpace($script:CommitMessage)) {
      throw "Commit message cannot be empty."
    }

    Step "Committing local code"
    git add .
    git commit -m $script:CommitMessage
  }

  Step "Pushing to GitHub"
  git push origin $branch
  Done "Code pushed to origin/$branch"
}

function Update-Server() {
  Step "Updating server code and dependencies"
  $remoteScript = @"
set -e
cd $serverPath
git pull origin $branch
npm install
node src/database/init.js
pm2 restart $pm2Name --update-env
pm2 status
"@
  Invoke-RemoteScript $remoteScript
  Done "Server update completed."
}

function Restart-ServerOnly() {
  Step "Restarting PM2 app only"
  $remoteScript = @"
set -e
cd $serverPath
pm2 restart $pm2Name --update-env
pm2 status
"@
  Invoke-RemoteScript $remoteScript
  Done "Server app restarted."
}

try {
  Set-Location $projectRoot
  Ensure-GitRepo

  if ([string]::IsNullOrWhiteSpace($Mode)) {
    $Mode = Ask-Mode
  }

  Step "Mode: $Mode"

  switch ($Mode) {
    "full" {
      Commit-And-Push
      Update-Server
    }
    "push-only" {
      Commit-And-Push
    }
    "server-only" {
      Update-Server
    }
    "restart-only" {
      Restart-ServerOnly
    }
    default {
      throw "Unknown mode: $Mode"
    }
  }

  Write-Host ""
  Done "Deploy finished. Hard refresh the browser before checking the page."
} catch {
  Write-Host ""
  Write-Host "Deploy failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
