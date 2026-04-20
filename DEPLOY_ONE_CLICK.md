# One-Click Deploy

This project includes local one-click deploy scripts:

- `deploy.bat`
- `deploy.ps1`

## Usage

Double-click this file in the project root:

```text
deploy.bat
```

The script will ask you to choose a mode:

1. Full deploy
2. Push only
3. Server only
4. Restart only

## Full deploy steps

1. Check local Git changes
2. `git add .`
3. `git commit`
4. `git push origin main`
5. SSH to the server
6. `git pull origin main`
7. `npm install`
8. `node src/database/init.js`
9. `pm2 restart xingjiawugongzi --update-env`

## Manual usage

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Mode full
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Mode push-only
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Mode server-only
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Mode restart-only
```

## Built-in config

- Server: `root@39.103.57.77`
- Project path: `/www/wwwroot/xingjiawugongzi`
- Branch: `main`
- PM2 app name: `xingjiawugongzi`

## Notes

- `deploy.bat` already uses PowerShell `Bypass`
- If SSH asks for a password, enter it when prompted
- If there are no local code changes, commit will be skipped
- If any step fails, the script stops immediately and prints the failing step
