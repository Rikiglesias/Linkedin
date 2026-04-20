# Hook: post-edit-antiban-audit.ps1
# Evento: PostToolUse — matcher: Edit|Write|MultiEdit
# Logga potenziali violazioni antiban (edit su file sensibili che non hanno passato pre-hook)

. "$PSScriptRoot\_lib.ps1"

$hook = Read-HookInput
if (-not $hook) { exit 0 }

$LOG_ANTIBAN    = 'C:\Users\albie\memory\antiban-hook-log.txt'
$LOG_VIOLATIONS = 'C:\Users\albie\memory\rule-violations-log.txt'

$filePaths = @()
if ($hook.tool_input.file_path) { $filePaths += $hook.tool_input.file_path }
if ($hook.tool_input.edits) {
    foreach ($edit in $hook.tool_input.edits) {
        if ($edit.file_path) { $filePaths += $edit.file_path }
    }
}

foreach ($file in $filePaths) {
    if (Test-AntibanFile $file) {
        # Controlla se c'è stato un blocco antiban oggi (significa il pre-hook ha fermato, ma non questo edit)
        $today = Get-Date -Format 'yyyy-MM-dd'
        $recentBlock = $false
        if (Test-Path $LOG_ANTIBAN) {
            $recentBlock = (Get-Content $LOG_ANTIBAN -ErrorAction SilentlyContinue |
                Where-Object { $_ -match $today -and $_ -match 'ANTIBAN' } |
                Select-Object -Last 1) -ne $null
        }
        if (-not $recentBlock) {
            Write-HookLog -File $LOG_VIOLATIONS -Message "POSSIBLE_RULE_MISS: antiban-review non eseguita per $([System.IO.Path]::GetFileName($file))"
        }
    }
}

exit 0
