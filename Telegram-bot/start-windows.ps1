Write-Host "Starting Telegram Airdrop Bot for Windows..." -ForegroundColor Green
Write-Host ""

# Function to kill process on port
function Kill-ProcessOnPort {
    param($Port)
    
    Write-Host "Cleaning up port $Port..." -ForegroundColor Yellow
    
    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    
    if ($connections) {
        $connections | ForEach-Object {
            $processId = $_.OwningProcess
            if ($processId -ne 0) {
                try {
                    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
                    Write-Host "  Killed process $processId on port $Port" -ForegroundColor Gray
                } catch {
                    # Process might have already exited
                }
            }
        }
    }
}

# Clean up ports
Kill-ProcessOnPort -Port 3001
Kill-ProcessOnPort -Port 3002

Write-Host ""
Write-Host "Ports cleaned successfully." -ForegroundColor Green
Write-Host ""

# Set up Ctrl+C handler
$null = [Console]::TreatControlCAsInput = $false

# Start the bot
Write-Host "Starting the bot..." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop gracefully" -ForegroundColor Yellow
Write-Host ""

npm run start:win

Write-Host ""
Write-Host "Bot stopped." -ForegroundColor Red
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")