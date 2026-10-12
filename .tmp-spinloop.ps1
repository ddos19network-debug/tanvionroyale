$tok = (Get-Content d:\tanvionroyale\.tmp-token.txt -Raw).Trim()
$uri = 'https://tanvionroyale.onrender.com/api/v1/games/royale-ace/spin'
1..20 | ForEach-Object {
  $id = [guid]::NewGuid().ToString()
  $j = '{"stake":1000,"clientRequestId":"' + $id + '"}'
  Set-Content d:\tanvionroyale\.tmp-spinbody.json -Value $j -NoNewline
  $full = curl.exe -s -w "|HTTP=%{http_code}" --max-time 40 -X POST $uri -H "Authorization: Bearer $tok" -H "Content-Type: application/json" --data-binary "@d:\tanvionroyale\.tmp-spinbody.json"
  $tail = $full.Substring([Math]::Max(0, $full.Length - 45))
  Write-Output ("spin {0} : {1}" -f $_, $tail)
}
