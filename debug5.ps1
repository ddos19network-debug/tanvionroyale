$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$lines = Get-Content -Path $path

# Show lines 1317-1325 (0-based) to identify TradingOrder model lines
Write-Output '=== Lines 1318-1325 (0-based) ==='
for ($i = 1318; $i -le 1325; $i++) {
    Write-Output ('Line 0-based ' + $i + ': ' + $lines[$i].Length + ': ' + $lines[$i])
}

# TradingOrder model starts at line 1317 (0-based) = "model TradingOrder {"
# Line 1318 (0-based) = "  id            String             @id @default(uuid())"
# Line 1319 (0-based) = "  accountId     String"
# Line 1320 (0-based) = "  instrumentId  String"
# Line 1321 (0-based) = "  side          TradingOrderSide"

Write-Output "`n=== Exact bytes for TradingOrder fields ==="
# Line 1319 (0-based) = accountId field
$bytes1 = [System.Text.Encoding]::UTF8.GetBytes($lines[1319])
Write-Output 'accountId line hex:'
$bytes1 | ForEach-Object { Write-Output ('0x{0:X2}' -f $_) }

# Line 1320 (0-based) = instrumentId field
$bytes2 = [System.Text.Encoding]::UTF8.GetBytes($lines[1320])
Write-Output 'instrumentId line hex:'
$bytes2 | ForEach-Object { Write-Output ('0x{0:X2}' -f $_) }

# Line 1321 (0-based) = side field
$bytes3 = [System.Text.Encoding]::UTF8.GetBytes($lines[1321])
Write-Output 'side line hex:'
$bytes3 | ForEach-Object { Write-Output ('0x{0:X2}' -f $_) }