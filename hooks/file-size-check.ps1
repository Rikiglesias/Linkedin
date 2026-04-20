# Hook: controlla che i file modificati non superino le 300 righe
# Chiamato da PostToolUse su Edit|Write

$input_data = $env:CLAUDE_TOOL_INPUT | ConvertFrom-Json -ErrorAction SilentlyContinue
$file = if ($input_data.file_path) { $input_data.file_path } else { '' }

if ($file -match '\.(ts|js|py|tsx|jsx)$' -and (Test-Path $file)) {
    $lines = (Get-Content $file -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
    if ($lines -gt 300) {
        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $msg = "$ts - FILE-SIZE VIOLATION: $file ha $lines righe (soglia 300). Considerare split SRP."
        Add-Content -Path 'C:\Users\albie\memory\quality-hook-log.txt' -Value $msg
    }
}
