$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$bytes = [System.IO.File]::ReadAllBytes($path)
$utf8 = New-Object System.Text.UTF8Encoding $false
$text = $utf8.GetString($bytes)

Write-Output '=== accountId occurrences ==='
$lines = $text.Split("`n")
for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match 'accountId') {
        Write-Output ('Line {0}: {1}' -f $i, $lines[$i])
    }
}