$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$text = Get-Content -Path $path -Raw
$nl = [Environment]::NewLine

# Define old and new patterns
$old = '  accountId     String' + $nl + '  instrumentId  String' + $nl + '  side          TradingOrderSide'
$new = '  accountId     String' + $nl + '  account       TradingAccount        @relation(fields: [accountId], references: [id], onDelete: Cascade)' + $nl + '  instrumentId  String' + $nl + '  instrument    TradingInstrument     @relation(fields: [instrumentId], references: [id])' + $nl + '  side          TradingOrderSide'

Write-Output 'Old pattern length: ' + $old.Length
Write-Output 'New pattern length: ' + $new.Length

if ($text.Contains($old)) {
    Write-Output 'Pattern FOUND'
    $text = $text.Replace($old, $new)
    Set-Content -Path $path -Value $text -Encoding UTF8
    Write-Output 'Relations added to TradingOrder'
} else {
    Write-Output 'Pattern NOT FOUND'
    $pos = $text.IndexOf('accountId     String')
    Write-Output ('Position: ' + $pos)
    $actual = $text.Substring($pos - 20, 80)
    Write-Output ('Actual: ' + $actual)
}