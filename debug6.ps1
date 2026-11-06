$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$text = Get-Content -Path $path -Raw
$nl = [Environment]::NewLine

# Find position of accountId
$pos = $text.IndexOf('accountId     String')
Write-Output ('Position: ' + $pos)

# Get 100 chars starting from pos - 20
$chunk = $text.Substring($pos - 20, 100)
Write-Output 'Chunk (100 chars):'
Write-Output $chunk

# Also check ifTradingOrderSide is on the next line
$line1319 = $text.Substring($pos, 30)
Write-Output 'Line around accountId:' 
Write-Output $line1319

# Search for 'TradingOrderSide' in a wider context
$ctx = $text.Substring($pos, 200)
Write-Output 'Context 200 chars:' 
Write-Output $ctx