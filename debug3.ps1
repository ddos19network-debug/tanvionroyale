$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$lines = Get-Content -Path $path
$i = 1318
Write-Output ('Line 1319 length: ' + $lines[$i].Length)
$lines[$i..1320] | ForEach-Object { Write-Output ('|' + $_ + '|') }