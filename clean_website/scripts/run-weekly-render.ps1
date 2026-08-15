# Runs the FocusStudy video pipeline unattended (via Windows Task Scheduler)
# so it works while nobody is watching: reset any local leftovers from a
# previous run, pull the latest code, render whatever's ready, then push the
# results back to GitHub so a scheduled Claude Code Remote routine can pick
# them up and publish. Logs everything to a timestamped file instead of the
# console, since Task Scheduler runs this with no visible window.
#
# One-time setup: see register-weekly-render-task.ps1 in this same folder.

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $repoRoot "clean_website\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "weekly-render-$(Get-Date -Format 'yyyy-MM-dd_HHmm').log"

Start-Transcript -Path $logFile -Append

Write-Host "=== FocusStudy weekly render: $(Get-Date) ==="

Set-Location $repoRoot

# Discard any local edits to the two files video-agent.ts itself rewrites --
# a previous run (or a manual test) can leave these modified, which would
# otherwise block the pull below. Anything real belongs in a commit, not an
# uncommitted local edit, so this is always safe to discard.
git checkout -- marketing/ideas/backlog.json marketing/video/queue.json 2>&1
git pull origin claude/focusstudy-publish-automation-nqyxss 2>&1

Set-Location (Join-Path $repoRoot "clean_website")
pnpm install 2>&1
pnpm --filter scripts run video:sync 2>&1

Set-Location $repoRoot
$changed = git status --porcelain -- marketing/ideas/backlog.json marketing/video/queue.json
if ($changed) {
    git add marketing/ideas/backlog.json marketing/video/queue.json
    git commit -m "Weekly render: $(Get-Date -Format 'yyyy-MM-dd')"
    git push origin claude/focusstudy-publish-automation-nqyxss 2>&1
    Write-Host "Pushed render results."
} else {
    Write-Host "No new videos rendered this run -- nothing to push."
}

Write-Host "=== Done: $(Get-Date) ==="
Stop-Transcript
