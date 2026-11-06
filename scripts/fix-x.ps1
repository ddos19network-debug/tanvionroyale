$path = "D:\tanvionroyale\apps\web\lib\data\games.ts"
$text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

# The X corruption: Royale Atlantis line ends with "5)," then "X  makeGame(103..."
# We need to fix it to have the correct Neon Cyber Rush line
$old = "'royale-atlantis`, 5),  X  makeGame(103, "
$new = "'royale-atlantis`, 5),`n  makeGame(102, `"ROYALE NEON CYBER RUSH`", `"TANVIONROYALE`", `"Slots`", 300, `"NEW`", true, `"freeplay`", `"neon-cyber-rush`", `"/assets/image/neon-cyber-rush/ROYALE NEON CYBER RUSH.jpg`", 6),`n  makeGame(103, "

if ($text -like "*$old*") {
    $text = $text -replace [regex]::Escape($old), $new
    [System.IO.File]::WriteAllText($path, $text, [System.Text.Encoding]::UTF8)
    Write-Output "Fixed: X corruption removed and Neon Cyber Rush line added"
} else {
    Write-Output "Pattern not found"
}
