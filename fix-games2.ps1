$path = 'D:/tanvionroyale/apps/web/lib/data/games.ts'
$text = Get-Content -Path $path -Raw
$nl = [Environment]::NewLine
$old = "const G = (a: number, b: number): string => `nfrom-[hsl(,70%,45%)] to-[hsl(,80%,30%)];"
$new = "const G = (a: number, b: number): string => `from-[hsl(${a},70%,45%)] to-[hsl(${b},80%,30%)]`;"
if ($text.Contains($old)) {
    $text = $text.Replace($old, $new)
    Set-Content -Path $path -Value $text -Encoding UTF8
    Write-Output 'Fixed'
} else {
    Write-Output 'Pattern not found'
}