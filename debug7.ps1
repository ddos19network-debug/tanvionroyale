$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$text = Get-Content -Path $path -Raw
$nl = [Environment]::NewLine

# Define old and new patterns exactly as they should appear
$old = "  accountId     String`n  instrumentId  String`n  side          TradingOrderSide"
$new = "  accountId     String`n  account       TradingAccount        @relation(fields: [accountId], references: [id], onDelete: Cascade)`n  instrumentId  String`n  instrument    TradingInstrument     @relation(fields: [instrumentId], references: [id])`n  side          TradingOrderSide"

Write-Output ('Old pattern: ' + $old)
Write-Output ('New pattern: ' + $new)
Write-Output ('Old length: ' + $old.Length)

if ($text.Contains($old)) {
    Write-Output 'Pattern FOUND'
    $text = $text.Replace($old, $new)
    Set-Content -Path $path -Value $text -Encoding UTF8
    Write-Output 'Relations added to TradingOrder'
} else {
    Write-Output 'Pattern NOT FOUND'
    
    # Try to find exact segments
    $pos = $text.IndexOf('accountId     String')
    if ($pos -ge 0) {
        $seg = $text.Substring($pos, 90)
        Write-Output "Segment from accountId: $seg"
    }
    
    # Check each line separately
    if ($text.Contains('  accountId     String')) { Write-Output 'accountId found' }
    if ($text.Contains('  instrumentId  String')) { Write-Output 'instrumentId found' }
    if ($text.Contains('  side          TradingOrderSide')) { Write-Output 'side found' }
    else { Write-Output 'side NOT found' }
    
    # Check what's after 'side'
    $sidePos = $text.IndexOf('  side')
    if ($sidePos -ge 0) {
        $sideSeg = $text.Substring($sidePos, 40)
        Write-Output "Side segment: $sideSeg"
        # Show char codes
        $chars = $sideSeg.ToCharArray()
        Write-Output 'Char codes:'
        $chars | ForEach-Object { Write-Output ('0x{0:X2}' -f [byte][char]$_) }
    }
}