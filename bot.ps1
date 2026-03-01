param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CliArgs
)

$entrypoint = Join-Path $PSScriptRoot "dist/index.js"
if (-not (Test-Path $entrypoint)) {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

node $entrypoint @CliArgs
