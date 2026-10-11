$ErrorActionPreference = "Continue"
$root = "D:\tanvionRoyale"
$log = "D:\tanvionRoyale\.tmp-final-validation\api-jest.log"
$exit = "D:\tanvionRoyale\.tmp-final-validation\api-jest.exit"
$report = "D:\tanvionRoyale\.tmp-final-validation\api-jest.json"
$jest = Join-Path $root "apps\api\node_modules\.bin\jest.CMD"
& $jest --config (Join-Path $root "apps\api\jest.config.js") --runInBand --silent --json --outputFile=$report *> $log
$code = $LASTEXITCODE
Set-Content -LiteralPath $exit -Value $code -NoNewline
