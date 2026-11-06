$path = 'D:/tanvionroyale/apps/web/lib/data/games.ts'
$bytes = [System.IO.File]::ReadAllBytes($path)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

# Fix the broken id line
$brokenLine = "    id: game-,"
$correctLine = "    id: `game-${id}`,"
$bytes2 = [System.Text.Encoding]::UTF8.GetBytes($brokenLine)
$broken = [System.Text.Encoding]::UTF8.GetString($bytes2)

if ($text.Contains($brokenLine)) {
    $text = $text.Replace($brokenLine, $correctLine)
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllBytes($path, $utf8.GetBytes($text))
    Write-Output 'Fixed'
} else {
    Write-Output 'Pattern not found'
}