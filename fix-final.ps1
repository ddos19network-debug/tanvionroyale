$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$bytes = [System.IO.File]::ReadAllBytes($path)
$utf8 = New-Object System.Text.UTF8Encoding $false
$text = $utf8.GetString($bytes)
$nl = [Environment]::NewLine

# Fix TradingOrder - add account and instrument relation fields
# File uses 2 spaces of indentation for these fields
$old = '  accountId     String' + $nl + '  instrumentId  String' + $nl + '  side          TradingOrderSide'
$new = '  accountId     String' + $nl + '  account       TradingAccount        @relation(fields: [accountId], references: [id], onDelete: Cascade)' + $nl + '  instrumentId  String' + $nl + '  instrument    TradingInstrument     @relation(fields: [instrumentId], references: [id])' + $nl + '  side          TradingOrderSide'

if ($text.Contains($old)) {
    $text = $text.Replace($old, $new)
    Write-Output 'TradingOrder relations added'
} else {
    Write-Output 'TradingOrder pattern not found'
}

# Fix TradingTransaction - add account relation field (2 spaces indent)
$old2 = '  accountId String' + $nl + '  type      TradingTransactionType'
$new2 = '  accountId String' + $nl + '  account   TradingAccount        @relation(fields: [accountId], references: [id], onDelete: Cascade)' + $nl + '  type      TradingTransactionType'

if ($text.Contains($old2)) {
    $text = $text.Replace($old2, $new2)
    Write-Output 'TradingTransaction relation added'
} else {
    Write-Output 'TradingTransaction pattern not found'
}

$bytes = $utf8.GetBytes($text)
[System.IO.File]::WriteAllBytes($path, $bytes)
Write-Output 'Done'