$p = 'D:\tanvionroyale\apps\web\components\games\ace-slot-game.tsx'
$lines = Get-Content $p
$out = $lines[0..877] + $lines[879..($lines.Count-1)]
Set-Content -Path $p -Value $out
Write-Host "done" $out.Count