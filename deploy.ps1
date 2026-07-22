# deploy.ps1
# Automates local build and pushes updates to GitHub

$accountName = "sohaibahmed368"
$repoName = "mexc-trailing-buy-bot"
$nodePath = "C:\Users\Hi\.gemini\antigravity\scratch\node-portable\node-v20.11.1-win-x64"

Write-Host "=== 1. Building Frontend ===" -ForegroundColor Cyan
$env:PATH = "$nodePath;" + $env:PATH
cd frontend
npm run build
cd ..

Write-Host "=== 2. Syncing Files to Deploy Folder ===" -ForegroundColor Cyan
$deployDir = "C:\Users\Hi\.gemini\antigravity\scratch\mexc-bot-deploy"

# Create directories if not exists
New-Item -ItemType Directory -Force -Path "$deployDir" | Out-Null
New-Item -ItemType Directory -Force -Path "$deployDir\backend" | Out-Null
New-Item -ItemType Directory -Force -Path "$deployDir\frontend" | Out-Null

# Copy files
Copy-Item -Path "Dockerfile" -Destination "$deployDir\" -Force
Copy-Item -Path "package.json" -Destination "$deployDir\" -Force
Copy-Item -Path "backend\server.js" -Destination "$deployDir\backend\" -Force
Copy-Item -Path "backend\mexc-client.js" -Destination "$deployDir\backend\" -Force
Copy-Item -Path "backend\tracker.js" -Destination "$deployDir\backend\" -Force
Copy-Item -Path "backend\package.json" -Destination "$deployDir\backend\" -Force
Copy-Item -Path "frontend\dist" -Destination "$deployDir\frontend\" -Recurse -Force

Write-Host "=== 3. Pushing Updates to GitHub ===" -ForegroundColor Cyan
cd $deployDir

# Initialize git in deploy folder if not already done
if (-not (Test-Path ".git")) {
    git init
    git branch -M main
    git remote add origin "https://github.com/$accountName/$repoName.git"
}

git add .
git commit -m "Update code: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
git push -u origin main

Write-Host "=== Deployment files successfully pushed to GitHub! ===" -ForegroundColor Green
Write-Host "Now log in to Alwaysdata SSH and run: git pull && cd backend && npm install" -ForegroundColor Yellow
