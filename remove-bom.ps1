$path = 'D:/tanvionroyale/database/prisma/schema.prisma'
$bytes = [System.IO.File]::ReadAllBytes($path)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $newBytes = New-Object byte[] ($bytes.Length - 3)
    [System.Array]::Copy($bytes, 3, $newBytes, 0, $newBytes.Length)
    [System.IO.File]::WriteAllBytes($path, $newBytes)
    Write-Output 'BOM removed'
} else {
    Write-Output 'No BOM found'
}