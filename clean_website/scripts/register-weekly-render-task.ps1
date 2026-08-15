# ONE-TIME SETUP. Run this once (from PowerShell, this repo's studyAI
# folder) to register a Windows Task Scheduler entry that runs
# run-weekly-render.ps1 automatically -- every Sunday morning, computer
# just needs to be powered on (locked/in the background is fine, no need
# to be logged in and watching it).
#
# To change the day/time later, or to remove it: open Task Scheduler
# (search "Task Scheduler" in the Start menu) -> find "FocusStudy Weekly
# Render" in the task list -> right-click to edit the trigger, or delete.

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptPath = Join-Path $repoRoot "clean_website\scripts\run-weekly-render.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

# Sundays at 8:00 AM -- change the day/time here before running if you'd
# rather it fire at a different point in the week.
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 8am

# RunOnlyIfNetworkAvailable: skips the run (instead of failing halfway
# through a git pull) if the computer happens to be offline at 8am.
# WakeToRun: if the computer is asleep (not fully off) at the scheduled
# time, this wakes it just long enough to run, then lets it go back to
# sleep -- it still needs to be powered on, but doesn't need to already be
# awake.
$settings = New-ScheduledTaskSettingsSet -RunOnlyIfNetworkAvailable -WakeToRun -StartWhenAvailable

Register-ScheduledTask -TaskName "FocusStudy Weekly Render" `
    -Action $action -Trigger $trigger -Settings $settings `
    -Description "Renders and pushes ready FocusStudy marketing videos, unattended." `
    -Force

Write-Host "Done. 'FocusStudy Weekly Render' is registered -- it'll run automatically every Sunday at 8am as long as the computer is on."
Write-Host "To test it right now instead of waiting for Sunday, run: Start-ScheduledTask -TaskName 'FocusStudy Weekly Render'"
