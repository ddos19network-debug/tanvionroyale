$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$text = Get-Content -Path $path -Raw

# Fix TradingTransaction - add account relation field
# File uses LF only (0x0A), not CRLF
$old = "  accountId String`n  type      TradingTransactionType"
$new = "  accountId String`n  account   TradingAccount        @relation(fields: [accountId], references: [id], onDelete: Cascade)`n  type      TradingTransactionType"

Write-Output ('Old pattern length: ' + $old.Length)
Write-Output ('New pattern length: ' + $new.Length)

if ($text.Contains($old)) {
    Write-Output 'Pattern FOUND'
    $text = $text.Replace($old, $new)
    Set-Content -Path $path -Value $text -Encoding UTF8
    Write-Output 'TradingTransaction relation added'
} else {
    Write-Output 'Pattern NOT FOUND'
    $pos = $text.IndexOf('accountId String')
    if ($pos -ge 0) {
        $seg = $text.Substring($pos - 5, 60)
        Write-Output "Segment: $seg"
    }
}