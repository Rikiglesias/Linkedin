# Hook: pre-edit-antiban.ps1
# Evento: PreToolUse — matcher: Edit|Write|MultiEdit
# Blocca Edit/Write/MultiEdit su file sensibili LinkedIn (antiban gate)

. "$PSScriptRoot\_lib.ps1"

$hook = Read-HookInput
if (-not $hook) { exit 0 }

$LOG = 'C:\Users\albie\memory\antiban-hook-log.txt'

# Raccoglie tutti i file_path toccati (Edit/Write singolo + MultiEdit array)
$filePaths = @()
if ($hook.tool_input.file_path) {
    $filePaths += $hook.tool_input.file_path
}
if ($hook.tool_input.edits) {
    foreach ($edit in $hook.tool_input.edits) {
        if ($edit.file_path) { $filePaths += $edit.file_path }
    }
}

foreach ($file in $filePaths) {
    if (Test-AntibanFile $file) {
        Write-HookLog -File $LOG -Message "ANTIBAN HARD-BLOCK: $file"
        Write-HookDecision -Decision deny -Reason "ANTIBAN: file sensibile LinkedIn ($([System.IO.Path]::GetFileName($file))). Eseguire /antiban-review, dichiarare SICURO, poi riprocedere."
        # Write-HookDecision chiama exit 0
    }
}

exit 0
