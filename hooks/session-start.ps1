# Hook: session-start.ps1
# Event: SessionStart
# Injects memory content (user, personality, preferences, decisions, active.md + project MEMORY.md)
# as additionalContext. This makes the startup memory load mechanical instead of self-compliance.
# Cap: 9000 chars total (docs limit: 10000)

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

. "$PSScriptRoot\_lib.ps1"

$GLOBAL_MEMORY = 'C:\Users\albie\memory'
$TODOS         = 'C:\Users\albie\todos\active.md'
$CLAUDE_PROJ   = 'C:\Users\albie\.claude\projects'

function Get-FileContent {
    param([string]$Path, [int]$MaxLines = 80)
    if (-not (Test-Path $Path)) { return '' }
    try {
        $lines = Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction Stop | Select-Object -First $MaxLines
        return ($lines -join "`n")
    } catch {
        return ''
    }
}

$files = @(
    @{ label = 'USER'; path = "$GLOBAL_MEMORY\user.md" },
    @{ label = 'PERSONALITY'; path = "$GLOBAL_MEMORY\personality.md" },
    @{ label = 'PREFERENCES'; path = "$GLOBAL_MEMORY\preferences.md" },
    @{ label = 'DECISIONS'; path = "$GLOBAL_MEMORY\decisions.md" },
    @{ label = 'ACTIVE_TODOS'; path = $TODOS }
)

$parts = @()
foreach ($f in $files) {
    $content = Get-FileContent -Path $f.path -MaxLines 60
    if ($content) {
        $parts += "### $($f.label)`n$content"
    }
}

try {
    $inputJson = [Console]::In.ReadToEnd()
    if ($inputJson) {
        $hookInput = $inputJson | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($hookInput -and $hookInput.cwd) {
            $key = $hookInput.cwd -replace '^([A-Za-z]):', '$1-' -replace '[\/]', '-' -replace '-+', '-'
            $projMemory = "$CLAUDE_PROJ\$key\memory\MEMORY.md"
            if (Test-Path $projMemory) {
                $content = Get-FileContent -Path $projMemory -MaxLines 30
                if ($content) {
                    $parts += "### PROJECT_MEMORY_INDEX`n$content"
                }
            }

            # Inject SESSION_HANDOFF.md if it exists in the project root
            $handoffPath = Join-Path ([string]$hookInput.cwd) 'SESSION_HANDOFF.md'
            if (Test-Path $handoffPath) {
                $handoff = Get-FileContent -Path $handoffPath -MaxLines 60
                if ($handoff) {
                    $parts = @("### SESSION_HANDOFF`n$handoff") + $parts
                }
            }

            $runtimeBrief = Get-ProjectRuntimeBrief -Cwd ([string]$hookInput.cwd) -MaxLines 120 -MaxChars 4500
            if ($runtimeBrief) {
                $parts = @("### PROJECT_RUNTIME_BRIEF`n$runtimeBrief") + $parts
            }

            $rulesDigest = Get-ProjectRulesDigest -Cwd ([string]$hookInput.cwd) -MaxChars 4000
            if ($rulesDigest) {
                $parts = @("### AI_RULES_DIGEST`n$rulesDigest") + $parts
            }
        }
    }
} catch {
    # Non-blocking on malformed input
}

$ctx = $parts -join "`n`n---`n`n"

if ($ctx.Length -gt 9000) {
    # Cut from the END (memory/todos are less critical than rules digest + runtime brief + handoff)
    $ctx = ($ctx.Substring(0, 9000)) + "`n`n[TRUNCATED - read full memory files if the task touches a specific topic]"
}

if (-not $ctx) { exit 0 }

$output = [ordered]@{
    hookSpecificOutput = [ordered]@{
        hookEventName = 'SessionStart'
        additionalContext = $ctx
    }
} | ConvertTo-Json -Compress -Depth 5

Write-Output $output
exit 0
