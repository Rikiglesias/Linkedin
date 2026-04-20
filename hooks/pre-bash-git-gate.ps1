# Hook: pre-bash-git-gate.ps1
# Evento: PreToolUse — matcher: Bash
# Enforcement git contestuale:
# - blocca git commit quando il working tree non e' in stato commit-ready
# - blocca git push quando il repository non e' in stato push-ready
# Nota: non esiste un evento "During" nativo in Claude Code; l'equivalente corretto
# e' l'enforcement continuo su ogni tool use + audit PostToolUse.

. "$PSScriptRoot\_lib.ps1"

$hook = Read-HookInput
if (-not $hook) { exit 0 }

$cmd = [string]$hook.tool_input.command
if ([string]::IsNullOrWhiteSpace($cmd)) { exit 0 }

$isGitCommit = $cmd -match '(^|\s)git\s+commit(\s|$)'
$isGitPush   = $cmd -match '(^|\s)git\s+push(\s|$)'
if (-not ($isGitCommit -or $isGitPush)) { exit 0 }

$LOG_VIOLATIONS = 'C:\Users\albie\memory\rule-violations-log.txt'

function Invoke-GitSafe {
    param(
        [string[]]$Args,
        [switch]$AllowFailure
    )
    try {
        $output = & git @Args 2>$null
        $exitCode = $LASTEXITCODE
    } catch {
        $output = $null
        $exitCode = 1
    }

    if ($exitCode -ne 0) {
        if ($AllowFailure) { return $null }
        throw "git $($Args -join ' ') fallito"
    }

    if ($null -eq $output) { return '' }
    return (($output -join "`n").Trim())
}

function Parse-ChangedFiles {
    $status = Invoke-GitSafe -Args @('status', '--porcelain=v1', '--untracked-files=all') -AllowFailure
    if ([string]::IsNullOrWhiteSpace($status)) { return @() }

    $items = @()
    foreach ($line in ($status -split "`r?`n")) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line.StartsWith('##')) { continue }

        $code = $line.Substring(0, [Math]::Min(2, $line.Length))
        $rawPath = if ($line.Length -gt 3) { $line.Substring(3).Trim() } else { '' }
        $path = if ($rawPath -match ' -> ') { ($rawPath -split ' -> ')[-1].Trim() } else { $rawPath.Trim() }
        $path = $path.Trim('"').Replace('\', '/')

        $items += [pscustomobject]@{
            Code      = $code
            Path      = $path
            Staged    = ($code.Length -ge 1 -and $code[0] -ne ' ' -and $code[0] -ne '?')
            Unstaged  = ($code.Length -ge 2 -and $code[1] -ne ' ' -and $code[1] -ne '?')
            Untracked = ($code -eq '??')
        }
    }

    return $items
}

function Get-TopLevelAreas {
    param([object[]]$Files)
    $areas = @()
    foreach ($file in $Files) {
        $parts = ($file.Path -split '/').Where({ $_ -ne '' })
        if ($parts.Count -le 1) {
            $areas += '(root)'
        } else {
            $areas += $parts[0]
        }
    }
    return @($areas | Sort-Object -Unique)
}

function Get-RiskyFiles {
    param([object[]]$Files)
    $items = @()
    foreach ($file in $Files) {
        $name = [System.IO.Path]::GetFileName($file.Path).ToLowerInvariant()
        if (
            $name -eq '.env' -or
            $name.StartsWith('.env.') -or
            $name.EndsWith('.pem') -or
            $name.EndsWith('.key') -or
            $name.EndsWith('.p12') -or
            $name.EndsWith('.pfx') -or
            $name -eq 'id_rsa' -or
            $name -eq 'id_dsa' -or
            $name -eq 'id_ed25519'
        ) {
            $items += $file.Path
        }
    }
    return @($items | Sort-Object -Unique)
}

function Test-SharedBranch {
    param([string]$Branch)
    if ([string]::IsNullOrWhiteSpace($Branch)) { return $false }
    return (
        $Branch -match '^(main|master|develop|development|staging|prod|production)$' -or
        $Branch -match '^(release|hotfix)/'
    )
}

function Test-GitMarker {
    param(
        [string]$GitDir,
        [string]$Marker
    )
    return Test-Path (Join-Path $GitDir $Marker)
}

function Deny-GitGate {
    param([string]$Reason)
    Write-HookLog -File $LOG_VIOLATIONS -Message "GIT_GATE BLOCK: $Reason | $cmd"
    Write-HookDecision -Decision deny -Reason $Reason
}

$cwd = if ($hook.cwd) { [string]$hook.cwd } else { (Get-Location).Path }
if (-not (Test-Path $cwd)) { exit 0 }

Push-Location $cwd
try {
    $inside = Invoke-GitSafe -Args @('rev-parse', '--is-inside-work-tree') -AllowFailure
    if ($inside -ne 'true') { exit 0 }

    $branch = Invoke-GitSafe -Args @('branch', '--show-current') -AllowFailure
    if ([string]::IsNullOrWhiteSpace($branch)) {
        Deny-GitGate -Reason 'GIT GATE: HEAD detached. Passare a un branch esplicito prima di commit o push.'
    }

    $gitDirRaw = Invoke-GitSafe -Args @('rev-parse', '--git-dir')
    $gitDir = if ([System.IO.Path]::IsPathRooted($gitDirRaw)) { $gitDirRaw } else { Join-Path $cwd $gitDirRaw }

    $gitOps = @()
    if (Test-GitMarker -GitDir $gitDir -Marker 'MERGE_HEAD') { $gitOps += 'merge' }
    if (Test-GitMarker -GitDir $gitDir -Marker 'rebase-merge') { $gitOps += 'rebase-merge' }
    if (Test-GitMarker -GitDir $gitDir -Marker 'rebase-apply') { $gitOps += 'rebase-apply' }
    if (Test-GitMarker -GitDir $gitDir -Marker 'CHERRY_PICK_HEAD') { $gitOps += 'cherry-pick' }
    if (Test-GitMarker -GitDir $gitDir -Marker 'REVERT_HEAD') { $gitOps += 'revert' }

    if ($gitOps.Count -gt 0) {
        Deny-GitGate -Reason "GIT GATE: operazione git in corso ($($gitOps -join ', ')). Chiudila prima di commit o push."
    }

    $files = Parse-ChangedFiles
    $stagedCount = @($files | Where-Object { $_.Staged }).Count
    $unstagedCount = @($files | Where-Object { $_.Unstaged }).Count
    $changedCount = $files.Count
    $areas = Get-TopLevelAreas -Files $files
    $riskyFiles = Get-RiskyFiles -Files $files

    if ($isGitCommit) {
        if ($changedCount -eq 0) {
            Deny-GitGate -Reason 'GIT GATE: nessuna modifica da committare.'
        }

        if ($riskyFiles.Count -gt 0) {
            Deny-GitGate -Reason "GIT GATE: file sensibili nel working tree ($($riskyFiles -join ', ')). Separarli prima del commit."
        }

        if ($stagedCount -gt 0 -and $unstagedCount -gt 0) {
            Deny-GitGate -Reason 'GIT GATE: index e working tree sono misti. Allineare lo scope del commit prima di procedere.'
        }

        if ($stagedCount -eq 0 -and $changedCount -gt 3) {
            Deny-GitGate -Reason 'GIT GATE: nessun file staged e perimetro troppo ampio. Stage esplicito dell''unita'' logica richiesto.'
        }

        if ($areas.Count -gt 3) {
            Deny-GitGate -Reason "GIT GATE: modifiche distribuite su troppe aree ($($areas -join ', ')). Ridurre o separare il commit."
        }

        if ($changedCount -gt 15) {
            Deny-GitGate -Reason "GIT GATE: working tree troppo esteso ($changedCount file) per un commit cieco."
        }
    }

    if ($isGitPush) {
        if ($changedCount -gt 0) {
            Deny-GitGate -Reason 'GIT GATE: working tree non pulito. Il push richiede prima una chiusura locale coerente.'
        }

        $upstream = Invoke-GitSafe -Args @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}') -AllowFailure
        if ([string]::IsNullOrWhiteSpace($upstream)) {
            if ($cmd -notmatch 'git\s+push\s+(-u\s+)?origin\b') {
                Deny-GitGate -Reason 'GIT GATE: upstream assente o strategia di push non esplicita.'
            }
        } else {
            $counts = Invoke-GitSafe -Args @('rev-list', '--left-right', '--count', '@{upstream}...HEAD')
            $parts = $counts -split '\s+'
            $behind = if ($parts.Count -ge 1) { [int]$parts[0] } else { 0 }
            $ahead  = if ($parts.Count -ge 2) { [int]$parts[1] } else { 0 }

            if ($behind -gt 0) {
                Deny-GitGate -Reason "GIT GATE: branch locale indietro di $behind commit rispetto a $upstream."
            }
            if ($ahead -eq 0) {
                Deny-GitGate -Reason "GIT GATE: nessun commit locale da pushare verso $upstream."
            }
        }

        if (Test-SharedBranch -Branch $branch) {
            Deny-GitGate -Reason "GIT GATE: branch condiviso/protetto ($branch). Push automatico vietato senza review contestuale."
        }
    }
} finally {
    Pop-Location
}

exit 0
