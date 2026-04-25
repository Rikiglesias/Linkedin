param()

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

. "$PSScriptRoot\_lib.ps1"

# ---------------------------------------------------------------------------
# Hook: pre-edit-secrets.ps1 (PreToolUse Edit|Write|MultiEdit)
# Blocca modifiche a file di credenziali/secret senza override esplicito.
# Codifica la regola "non toccare .env e key material" come hook FORZATO.
# ---------------------------------------------------------------------------

$LOG = 'C:\Users\albie\memory\secrets-hook-log.txt'

$payload = Read-HookInput
if (-not $payload) { exit 0 }

$SECRET_PATTERN = '(\.env(\.|$)|\.env\..+|secrets?\.json$|credentials?\.json$|service-account.*\.json$|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|id_ed25519|gcp-key.*\.json$|aws-credentials)'

$filePaths = @()
if ($payload.tool_input.file_path) {
    $filePaths += $payload.tool_input.file_path
}
if ($payload.tool_input.edits) {
    foreach ($edit in $payload.tool_input.edits) {
        if ($edit.file_path) { $filePaths += $edit.file_path }
    }
}

foreach ($file in $filePaths) {
    $name = [System.IO.Path]::GetFileName($file)
    if ($file -match $SECRET_PATTERN -or $name -match $SECRET_PATTERN) {
        # Override esplicito: file con suffisso .example o dentro test/fixtures
        if ($file -match '\.example$|\.sample$|\\test\\|\\tests\\|\\fixtures\\|/test/|/tests/|/fixtures/') {
            continue
        }
        Write-HookLog -File $LOG -Message "SECRETS HARD-BLOCK: $file"
        Write-HookDecision -Decision deny -Reason "SECRETS: file di credenziali ($name). Modifica BLOCCATA. Se serve davvero, dichiarare esplicitamente perche e usare l interfaccia di gestione segreti del provider (Vercel env, Supabase secrets, ecc.), non il file diretto."
    }
}

exit 0
