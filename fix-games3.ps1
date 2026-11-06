$path = 'D:/tanvionroyale/apps/web/lib/data/games.ts'
$lines = Get-Content -Path $path
# Line 51 (0-based 50) is the G() function - replace it entirely
$lines[50] = "const G = (a: number, b: number): string => `from-[hsl(${a},70%,45%)] to-[hsl(${b},80%,30%)]`;"
Set-Content -Path $path -Value $lines -Encoding UTF8
Write-Output "Line 51 replaced"
# Verify
Get-Content -Path $path | Select-Object -Index 50