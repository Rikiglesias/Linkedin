# Hook: stop-session.ps1
# Evento: Stop
# Logga fine sessione con timestamp ISO reale e working directory

. "$PSScriptRoot\_lib.ps1"

$LOG = 'C:\Users\albie\memory\session-log.txt'

try {
    $cwd = (Get-Location).Path
} catch {
    $cwd = 'unknown'
}

Write-HookLog -File $LOG -Message "Sessione chiusa in: $cwd. Aggiorna todos/active.md e memory/ se necessario."

# Verifica se ENGINEERING_WORKLOG.md e' stato aggiornato nella sessione
try {
    $worklogPath = Join-Path $cwd 'docs\tracking\ENGINEERING_WORKLOG.md'
    if (Test-Path $worklogPath) {
        $diffOutput = git -C $cwd diff HEAD -- 'docs/tracking/ENGINEERING_WORKLOG.md' 2>$null
        $stagedOutput = git -C $cwd diff --cached -- 'docs/tracking/ENGINEERING_WORKLOG.md' 2>$null
        if (-not $diffOutput -and -not $stagedOutput) {
            Write-HookLog -File $LOG -Message "WORKLOG: ENGINEERING_WORKLOG.md non aggiornato in questa sessione."
            Write-Host "ENGINEERING_WORKLOG.md non e' stato aggiornato in questa sessione." -ForegroundColor Yellow
            Write-Host "Aggiungere entry in docs/tracking/ENGINEERING_WORKLOG.md prima del prossimo commit." -ForegroundColor Yellow
        }
    }
} catch {
    # non bloccante
}

# Verifica se todos/active.md e' stato aggiornato nella sessione
try {
    $todosPath = 'C:\Users\albie\todos\active.md'
    if (Test-Path $todosPath) {
        $todosDiff = git -C (Split-Path $todosPath) diff HEAD -- 'active.md' 2>$null
        $todosStaged = git -C (Split-Path $todosPath) diff --cached -- 'active.md' 2>$null
        if (-not $todosDiff -and -not $todosStaged) {
            Write-HookLog -File $LOG -Message "TODOS: active.md non aggiornato in questa sessione."
        }
    }
} catch {
    # non bloccante — todos potrebbe non essere in un repo git
}

exit 0
