$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$chromeCandidates = @(
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$browser = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw 'Chrome or Microsoft Edge is required to render the icon PNG files.' }

Push-Location $projectRoot
try {
  node build\icon_concepts.mjs
  $rootUrl = $projectRoot.Replace('\', '/')

  1..6 | ForEach-Object {
    $number = $_.ToString('00')
    $arguments = @(
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--default-background-color=00000000', '--force-device-scale-factor=1',
      '--window-size=1024,1024',
      "--user-data-dir=$env:TEMP\tinymd-candidate-$number",
      "--screenshot=$projectRoot\icon-candidate-$number.png",
      "file:///$rootUrl/icon-candidate-$number.svg"
    )
    Start-Process -FilePath $browser -ArgumentList $arguments -WindowStyle Hidden -Wait | Out-Null
  }

  $previewArguments = @(
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--window-size=1320,1000',
    "--user-data-dir=$env:TEMP\tinymd-candidate-preview",
    "--screenshot=$projectRoot\icon-candidates-preview.png",
    "file:///$rootUrl/icon-candidates-preview.html"
  )
  Start-Process -FilePath $browser -ArgumentList $previewArguments -WindowStyle Hidden -Wait | Out-Null

  $sizeDirectory = Join-Path $PSScriptRoot 'icon-sizes-03'
  New-Item -ItemType Directory -Path $sizeDirectory -Force | Out-Null
  @(16, 20, 24, 32, 40, 48, 64, 128, 256) | ForEach-Object {
    $size = $_
    $scale = $size / 1024
    $arguments = @(
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--default-background-color=00000000', "--force-device-scale-factor=$scale",
      '--window-size=1024,1024',
      "--user-data-dir=$env:TEMP\tinymd-official-icon-$size",
      "--screenshot=$sizeDirectory\$size.png",
      "file:///$rootUrl/icon-candidate-03.svg"
    )
    Start-Process -FilePath $browser -ArgumentList $arguments -WindowStyle Hidden -Wait | Out-Null
  }

  node build\apply_icon.mjs 03
} finally {
  Pop-Location
}
