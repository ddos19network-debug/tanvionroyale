$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$text = Get-Content -Path $path -Raw
$nl = [Environment]::NewLine

# Fix 1: Add positions to TradingAccount
$old1 = '  orders       TradingOrder[]'
$new1 = '  orders           TradingOrder[]' + $nl + '  positions        TradingPosition[]'

if ($text.Contains($old1)) {
    $text = $text.Replace($old1, $new1)
    Write-Output 'Added positions to TradingAccount'
} else {
    Write-Output 'TradingAccount positions pattern NOT FOUND'
}

# Fix 2: Add positions to TradingInstrument
$old2 = '  sortOrder  Int                   @default(0)'
$new2 = '  sortOrder  Int                   @default(0)' + $nl + '  positions    TradingPosition[]'

if ($text.Contains($old2)) {
    $text = $text.Replace($old2, $new2)
    Write-Output 'Added positions to TradingInstrument'
} else {
    Write-Output 'TradingInstrument positions pattern NOT FOUND'
}

Set-Content -Path $path -Value $text -Encoding UTF8