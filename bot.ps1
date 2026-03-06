param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CliArgs
)

$entrypoint = Join-Path $PSScriptRoot "dist/index.js"
$shouldBuild = -not (Test-Path $entrypoint)

if (-not $shouldBuild) {
    $entrypointTime = (Get-Item $entrypoint).LastWriteTimeUtc
    $sourceCandidates = @(
        (Join-Path $PSScriptRoot "src"),
        (Join-Path $PSScriptRoot "public"),
        (Join-Path $PSScriptRoot "package.json"),
        (Join-Path $PSScriptRoot "tsconfig.json"),
        (Join-Path $PSScriptRoot "tsconfig.frontend.json")
    ) | Where-Object { Test-Path $_ }

    foreach ($candidate in $sourceCandidates) {
        $item = Get-Item $candidate
        if ($item.PSIsContainer) {
            $latestSource = Get-ChildItem $candidate -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
            if ($latestSource -and $latestSource.LastWriteTimeUtc -gt $entrypointTime) {
                $shouldBuild = $true
                break
            }
        }
        elseif ($item.LastWriteTimeUtc -gt $entrypointTime) {
            $shouldBuild = $true
            break
        }
    }
}

if ($shouldBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

node $entrypoint @CliArgs
