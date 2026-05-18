param(
  [string]$Provider = "anthropic",
  [int]$ChunkSize = 10,
  [int]$StartPage = 1,
  [int]$EndPage = 203
)

$ErrorActionPreference = "Stop"

$root = "C:\Users\Projecta0003\Desktop\genio-ai-next\.claude\worktrees\competent-heyrovsky-3a3c90"
$python = "C:\Users\Projecta0003\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$script = Join-Path $root "scripts\build_bmtq_training.py"

for ($page = $StartPage; $page -le $EndPage; $page += $ChunkSize) {
  $chunkEnd = [Math]::Min($page + $ChunkSize - 1, $EndPage)
  Write-Host "Processing pages $page-$chunkEnd with provider $Provider"
  & $python $script `
    --start-page $page `
    --end-page $chunkEnd `
    --provider $Provider `
    --resume `
    --continue-on-error `
    --sleep 0.5
}

Write-Host "Full handbook training run completed."
