$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$text = Get-Content -Path $path -Raw

# Remove reverse relations from TradingAsset
$text = $text -replace "`n  pairs\s+TradingPair\[\]", ''
$text = $text -replace "`n  positions\s+TradingPosition\[\]", ''

# Remove relation object fields from TradingPair (keep scalar baseAssetId/quoteAssetId which already exist)
$text = $text -replace "`n  baseAsset\s+TradingAsset\s+@relation\(""BaseAsset"",\s*fields:\s*\[baseAssetId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)", ''
$text = $text -replace "`n  quoteAsset\s+TradingAsset\s+@relation\(""QuoteAsset"",\s*fields:\s*\[quoteAssetId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)", ''

Set-Content -Path $path -Value $text -Encoding UTF8
Write-Output 'Schema fixed'