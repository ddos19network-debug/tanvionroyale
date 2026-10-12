$p = 'apps/api/test/affiliate.spec.ts'
$lines = (Get-Content -Raw $p) -split "`r?`n"
$start = $null
for ($i=0; $i -lt $lines.Length; $i++) {
    if ($lines[$i].Trim().StartsWith("describe('L.")) { $start = $i; break }
}
Write-Host "L describe at line $($start+1)"
Write-Host "before: $($lines[$start-1])"
Write-Host "last line: $($lines[$lines.Length-1])"