$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$text = Get-Content -Path $path -Raw
$nl = [Environment]::NewLine

# Fix TradingTransaction - add account relation field
$old = '  accountId String' + $nl + '  type      TradingTransactionType'
$new = '  accountId String' + $nl + '  account   TradingAccount        @relation(fields: [accountId], references: [id], onDelete: Cascade)' + $nl + '  type      TradingTransactionType'

Write-Output ('Old pattern length: ' + $old.Length)
Write-Output ('New pattern length: ' + $new.Length)

if ($text.Contains($old)) {
    Write-Output 'Pattern FOUND - adding relation'
    $text = $text.Replace($old, $new)
    Set-Content -Path $path -Value $text -Encoding UTF8
    Write-Output 'TradingTransaction relation added'
} else {
    Write-Output 'Pattern NOT FOUND'
    # Debug: find accountId String
    $pos = $text.IndexOf('accountId String')
    if ($pos -ge 0) {
        $seg = $text.Substring($pos - 5, 60)
        Write-Output "Segment: $seg"
        # Check char by char
        $chars = $seg.ToCharArray()
        Write-Output 'Char codes:'
        $chars | ForEach-Object { Write-Output ('0x{0:X2}' -f [byte][char]$_) }
    }
}