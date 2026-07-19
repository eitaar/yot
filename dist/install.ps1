$ErrorActionPreference = "Stop"

$Repo = "eitaar/yot"
$DataDir = if ($env:YOT_DATA_DIR) { $env:YOT_DATA_DIR } else { "$env:APPDATA\yot" }

Write-Host "yot installer"
Write-Host "  Install: $DataDir"
Write-Host ""

# Get latest version
Write-Host "==> Fetching latest version"
$Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
$Version = $Release.tag_name
Write-Host "==> Latest version: $Version"

# Download
$Arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "arm64" }
$Archive = "yot-$Version-windows-$Arch.zip"
$Url = "https://github.com/$Repo/releases/download/$Version/$Archive"
$TmpDir = Join-Path ([IO.Path]::GetTempPath()) "yot-install"

New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
$ZipPath = Join-Path $TmpDir $Archive

Write-Host "==> Downloading $Archive"
Invoke-WebRequest -Uri $Url -OutFile $ZipPath

# Extract and install
Write-Host "==> Installing to $DataDir"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Expand-Archive -Path $ZipPath -DestinationPath "$TmpDir\extract" -Force

Get-ChildItem "$TmpDir\extract" -Recurse -Filter "*.exe" | ForEach-Object {
    Copy-Item $_.FullName -Destination $DataDir -Force
}

Remove-Item -Recurse -Force $TmpDir

# Add to PATH
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$DataDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$DataDir;$UserPath", "User")
    $env:Path = "$DataDir;$env:Path"
    Write-Host "  Added $DataDir to user PATH (restart terminal to take effect)"
}

# Init
Write-Host "==> Running yot init"
& "$DataDir\yot.exe" init

Write-Host ""
Write-Host "Done! Start the server with:"
Write-Host "  yot-server"
