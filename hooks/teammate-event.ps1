# Hook: teammate-event.ps1
# Eventi: TeammateIdle, TaskCreated, TaskCompleted
# Logga eventi teammate con timestamp ISO reale

. "$PSScriptRoot\_lib.ps1"

param(
    [Parameter(Mandatory=$false)]
    [string]$Event = 'Unknown'
)

$LOG = 'C:\Users\albie\memory\teams-log.txt'
Write-HookLog -File $LOG -Message "Teammate event: $Event"

exit 0
