$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$lines = Get-Content -Path $path

Write-Output '=== TradingTransaction model fields ==='
for ($i = 1363; $i -le 1370; $i++) {
    Write-Output ('Line 0-based ' + $i + ': ' + $lines[$i].Length + ': ' + $lines[$i])
}