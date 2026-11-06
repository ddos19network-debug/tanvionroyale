$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$text = Get-Content -Path $path -Raw

# Remove relation object fields from TradingPosition (keep scalar accountId/instrumentId)
$text = $text -replace "`n  account\s+TradingAccount\s+@relation\(fields:.*?onDelete: Cascade\)", ''
$text = $text -replace "`n  instrument\s+TradingInstrument\s+@relation\(fields:.*?\)", ''

Set-Content -Path $path -Value $text -Encoding UTF8
Write-Output 'TradingPosition relations fixed'