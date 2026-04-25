param()

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

. "$PSScriptRoot\_lib.ps1"

# ---------------------------------------------------------------------------
# Hook: post-bash-auto-push.ps1 (PostToolUse Bash matcher)
# Trigger automatico di `git push` dopo `git commit` se precondizioni vere.
# Codifica la regola AGENTS.md "Auto-push post-commit" come hook FORZATO.
# ---------------------------------------------------------------------------

$LOG = 'C:\Users\albie\memory\auto-push-log.txt'

$payload = Read-HookInput
if (-not $payload) { exit 0 }

# Solo per Bash tool
if ($payload.tool_name -ne 'Bash') { exit 0 }

$cmd = ''
try { $cmd = [string]$payload.tool_input.command } catch { exit 0 }
if ([string]::IsNullOrWhiteSpace($cmd)) { exit 0 }

# Match solo `git commit` riuscito (non `git commit --amend`, non check-only, non message-only)
if ($cmd -notmatch '\bgit\s+commit\b') { exit 0 }
if ($cmd -match '--amend|--dry-run|--message-only') { exit 0 }

# Verifica exit code del comando appena eseguito
$exitCode = -1
try { $exitCode = [int]$payload.tool_response.exit_code } catch {}
if ($exitCode -ne 0) {
    Write-HookLog -File $LOG -Message "Skip auto-push: commit exit_code=$exitCode"
    exit 0
}

$cwd = Get-HookCwd -HookInput $payload
if ([string]::IsNullOrWhiteSpace($cwd) -or -not (Test-Path -LiteralPath $cwd)) { exit 0 }

# Solo repo git
$gitDir = Join-Path $cwd '.git'
if (-not (Test-Path -LiteralPath $gitDir)) { exit 0 }

# Precondizioni cumulative
$reasons = @()

# 1. Branch e upstream
try {
    $branch = (git -C $cwd rev-parse --abbrev-ref HEAD 2>$null).Trim()
    $upstream = (git -C $cwd rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null).Trim()
    if ([string]::IsNullOrWhiteSpace($upstream)) {
        $reasons += "no upstream configurato"
    }
} catch {
    $reasons += "git branch/upstream non leggibile"
}

# 2. No divergenza con remote
try {
    git -C $cwd fetch --quiet 2>$null
    $behind = [int]((git -C $cwd rev-list --count "HEAD..@{u}" 2>$null) -as [int])
    if ($behind -gt 0) {
        $reasons += "remote divergente ($behind commits behind)"
    }
} catch {}

# 3. audit:git-automation READY (best-effort, non bloccante se script assente)
try {
    $auditOutput = npm --prefix $cwd run audit:git-automation:json --silent 2>$null
    if ($auditOutput) {
        $audit = $auditOutput | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($audit -and $audit.push -and $audit.push.status -ne 'READY') {
            $reasons += "audit:git-automation push.status=$($audit.push.status)"
        }
    }
} catch {}

# 4. Branch protetto senza policy chiara — su questo repo personale main e' OK,
#    ma su branch sconosciuti meglio fermarsi
$protectedNoOverride = $false
if ($branch -match '^(production|prod|release|release/.*|hotfix/.*)$') {
    $protectedNoOverride = $true
    $reasons += "branch protetto '$branch' senza policy override"
}

# 5. Working tree pulito (no uncommitted leftover che il push non porterebbe)
try {
    $dirty = (git -C $cwd status --porcelain 2>$null) | Where-Object { $_ -and $_ -notmatch '^\?\?' }
    if ($dirty) {
        # File modificati non committati — non blocca push, ma logga
    }
} catch {}

if ($reasons.Count -gt 0) {
    $reasonText = $reasons -join '; '
    Write-HookLog -File $LOG -Message "Auto-push SKIP su ${branch}: $reasonText"

    $msg = "AUTO-PUSH SKIPPED - commit done but push not triggered. Reason: $reasonText. AI must declare this to the user and propose the correct action (PR, fetch+rebase, explicit confirmation)."
    $output = [ordered]@{
        hookSpecificOutput = [ordered]@{
            hookEventName    = 'PostToolUse'
            additionalContext = $msg
        }
    } | ConvertTo-Json -Compress -Depth 5
    Write-Output $output
    exit 0
}

# Tutte le precondizioni verdi → push
try {
    $pushOutput = git -C $cwd push 2>&1
    $pushExit = $LASTEXITCODE
    if ($pushExit -eq 0) {
        Write-HookLog -File $LOG -Message "Auto-push OK su $branch -> $upstream"
        $msg = "AUTO-PUSH ESEGUITO — branch=$branch -> $upstream. Output: $($pushOutput -join ' | ')"
    } else {
        Write-HookLog -File $LOG -Message "Auto-push FAIL su ${branch}: exit=$pushExit, output=$pushOutput"
        $msg = "AUTO-PUSH FAILED - branch=$branch, exit=$pushExit. Output: $($pushOutput -join ' | '). AI must declare and propose fix."
    }
    $output = [ordered]@{
        hookSpecificOutput = [ordered]@{
            hookEventName    = 'PostToolUse'
            additionalContext = $msg
        }
    } | ConvertTo-Json -Compress -Depth 5
    Write-Output $output
} catch {
    Write-HookLog -File $LOG -Message "Auto-push exception: $($_.Exception.Message)"
}

exit 0
