# Hook: post-bash-git-audit.ps1
# Evento: PostToolUse — matcher: Bash
# Esegue audit automatico "durante" il lavoro sui punti quality/git:
# - dopo post-modifiche / conta-problemi
# - dopo git commit / git push
# Claude Code non espone un evento DURING generico: il pattern corretto e'
# SessionStart + PreToolUse + PostToolUse + Stop.

. "$PSScriptRoot\_lib.ps1"

$hook = Read-HookInput
if (-not $hook) { exit 0 }

$cmd = [string]$hook.tool_input.command
if ([string]::IsNullOrWhiteSpace($cmd)) { exit 0 }

if ($cmd -notmatch '(npm run post-modifiche|npm run conta-problemi|git\s+commit|git\s+push)') {
    exit 0
}

$LOG = 'C:\Users\albie\memory\git-hook-log.txt'
$cwd = if ($hook.cwd) { [string]$hook.cwd } else { (Get-Location).Path }
if (-not (Test-Path $cwd)) { exit 0 }

$exitCode = ''
if ($hook.tool_result -and $hook.tool_result.exit_code -ne $null) {
    $exitCode = [string]$hook.tool_result.exit_code
}

Push-Location $cwd
try {
    $json = & npx ts-node src/scripts/gitAutomationAudit.ts --json 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($json -join ''))) {
        Write-HookLog -File $LOG -Message "POST-BASH GIT_AUDIT: trigger=$cmd exit=$exitCode audit=unavailable"
        exit 0
    }

    $report = ($json -join "`n") | ConvertFrom-Json -ErrorAction Stop
    $branch = if ($report.repo.branch) { [string]$report.repo.branch } else { '(detached)' }
    $upstream = if ($report.repo.upstream) { [string]$report.repo.upstream } else { '(none)' }
    $commitState = [string]$report.decisions.commit.status
    $pushState = [string]$report.decisions.push.status
    $changed = [string]$report.workingTree.changedFiles

    Write-HookLog -File $LOG -Message "POST-BASH GIT_AUDIT: trigger=$cmd exit=$exitCode commit=$commitState push=$pushState branch=$branch upstream=$upstream changed=$changed"

    if (
        $exitCode -eq '0' -and
        $cmd -match '(npm run post-modifiche|npm run conta-problemi)' -and
        $commitState -eq 'ready'
    ) {
        Write-HookLog -File $LOG -Message "AUTOCOMMIT_CANDIDATE: quality gate verde e repository commit-ready su branch $branch"
    }
} catch {
    Write-HookLog -File $LOG -Message "POST-BASH GIT_AUDIT: trigger=$cmd exit=$exitCode audit=parse-failed"
} finally {
    Pop-Location
}

exit 0
