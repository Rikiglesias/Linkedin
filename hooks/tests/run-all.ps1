# Run All Hook Tests
$results = @()
$tests = @(
    "test-pre-edit-antiban.ps1",
    "test-pre-bash-l1-gate.ps1",
    "test-session-start.ps1",
    "test-stop-hook.ps1"
)

foreach ($t in $tests) {
    Write-Host "Running $t..."
    powershell -File "C:\Users\albie\.claude\hooks\tests\$t"
    if ($LASTEXITCODE -eq 0) {
        $results += "PASS: $t"
    } else {
        $results += "FAIL: $t"
    }
}

$results | Out-File "C:\Users\albie\.claude\hooks\tests\results.txt"
if ($results -match "FAIL") { exit 1 }
exit 0
