[CmdletBinding()]
param(
    [switch]$SkipLaunch,
    [switch]$SkipShortcut,
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$minimumNodeMajor = 18
$appUrl = "http://127.0.0.1:8080/index.html"

function Write-Step {
    param(
        [int]$Number,
        [string]$Message
    )

    Write-Host ""
    Write-Host "[$Number/5] $Message" -ForegroundColor Cyan
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machinePath, $userPath) -join ";"
}

function Get-NodeStatus {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        return [pscustomobject]@{
            Available = $false
            Version = $null
            Major = 0
            Path = $null
        }
    }

    $versionText = (& $command.Source --version).Trim().TrimStart("v")
    $version = $null
    if (-not [Version]::TryParse($versionText, [ref]$version)) {
        throw "Node.js is installed, but its version could not be read from '$($command.Source)'."
    }

    return [pscustomobject]@{
        Available = $true
        Version = $version
        Major = $version.Major
        Path = $command.Source
    }
}

function Confirm-Choice {
    param(
        [string]$Prompt,
        [bool]$DefaultYes = $true
    )

    if ($NonInteractive) {
        return $DefaultYes
    }

    $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
    $answer = (Read-Host "$Prompt $suffix").Trim()
    if (-not $answer) {
        return $DefaultYes
    }
    return $answer -match "^(y|yes)$"
}

function Install-Node {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw @"
Node.js $minimumNodeMajor or later is required, and Windows Package Manager was not found.

Install the current Node.js LTS release from:
https://nodejs.org/en/download

Keep the installer option that adds Node.js to PATH, reopen this setup, and run it again.
"@
    }

    if (-not (Confirm-Choice "Node.js is missing or too old. Install the current Node.js LTS release now?")) {
        throw "Node.js installation was declined. Install Node.js $minimumNodeMajor or later, then run setup again."
    }

    Write-Host "Installing Node.js LTS with Windows Package Manager..." -ForegroundColor Yellow
    & $winget.Source install `
        --id OpenJS.NodeJS.LTS `
        --exact `
        --source winget `
        --accept-package-agreements `
        --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Windows Package Manager could not install Node.js. Install it from https://nodejs.org/en/download, then run setup again."
    }

    Refresh-Path
}

function Test-AiFlightDeckListener {
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/status" -TimeoutSec 2
        return $status.service -eq "ai-flight-deck-local" -and $status.ready -eq $true
    }
    catch {
        return $false
    }
}

function Test-PortInUse {
    try {
        return $null -ne (Get-NetTCPConnection `
            -LocalAddress "127.0.0.1" `
            -LocalPort 8080 `
            -State Listen `
            -ErrorAction SilentlyContinue |
            Select-Object -First 1)
    }
    catch {
        return $false
    }
}

function New-DesktopShortcut {
    $desktop = [Environment]::GetFolderPath("Desktop")
    if (-not $desktop) {
        return
    }

    $shortcutPath = Join-Path $desktop "AI Flight Deck.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $PSScriptRoot "Start-AI-Flight-Deck.cmd"
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.Description = "Start AI Flight Deck"
    $shortcut.Save()
    Write-Host "Desktop shortcut created: $shortcutPath" -ForegroundColor Green
}

try {
    Write-Host "AI Flight Deck guided setup" -ForegroundColor White
    Write-Host "Installation folder: $PSScriptRoot"

    Write-Step 1 "Checking Windows and the application files"
    if ($env:OS -ne "Windows_NT") {
        throw "This guided setup currently supports Windows 10 and Windows 11."
    }
    foreach ($requiredFile in @(
        "Start-AI-Flight-Deck.cmd",
        "server.js",
        "index.html",
        "enablement-playbook.js",
        "evidence-completion.js",
        "attestation-evidence.js",
        "scanner\collect-admin-evidence.ps1",
        "schema\power-platform-evidence.template.v1.json",
        "scanner\test-live-tenant.ps1"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $requiredFile))) {
            throw "The installation is incomplete. Missing file: $requiredFile. Download and extract the full repository again."
        }
    }
    Write-Host "Application files are complete." -ForegroundColor Green

    Write-Step 2 "Checking Node.js"
    $node = Get-NodeStatus
    if (-not $node.Available -or $node.Major -lt $minimumNodeMajor) {
        Install-Node
        $node = Get-NodeStatus
    }
    if (-not $node.Available -or $node.Major -lt $minimumNodeMajor) {
        throw "Node.js was installed but is not yet available in this terminal. Restart Windows or reopen the folder, then run setup again."
    }
    Write-Host "Node.js $($node.Version) is ready: $($node.Path)" -ForegroundColor Green

    Write-Step 3 "Checking the Microsoft Graph authentication connector"
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
        if (-not (Confirm-Choice "Install Microsoft.Graph.Authentication for the current Windows user?")) {
            throw "The Microsoft Graph authentication module is required for live tenant scans."
        }
        Write-Host "Installing Microsoft.Graph.Authentication from PowerShell Gallery..." -ForegroundColor Yellow
        if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)) {
            Write-Host "Installing the NuGet package provider for the current user..." -ForegroundColor Yellow
            Install-PackageProvider NuGet `
                -MinimumVersion 2.8.5.201 `
                -Scope CurrentUser `
                -Force `
                -Confirm:$false | Out-Null
        }
        Install-Module Microsoft.Graph.Authentication `
            -Scope CurrentUser `
            -Force `
            -AllowClobber `
            -Confirm:$false
    }
    $graphModule = Get-Module -ListAvailable -Name Microsoft.Graph.Authentication |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if (-not $graphModule) {
        throw "Microsoft.Graph.Authentication could not be installed."
    }
    Write-Host "Microsoft Graph authentication $($graphModule.Version) is ready." -ForegroundColor Green

    Write-Step 4 "Checking local port 8080"
    $alreadyRunning = Test-AiFlightDeckListener
    if (-not $alreadyRunning -and (Test-PortInUse)) {
        throw "Port 8080 is already used by another application. Close that application, then run setup again."
    }
    if ($alreadyRunning) {
        Write-Host "AI Flight Deck is already running." -ForegroundColor Green
    }
    else {
        Write-Host "Port 8080 is available." -ForegroundColor Green
    }

    Write-Step 5 "Finishing setup"
    if (-not $SkipShortcut -and
        (Confirm-Choice "Create an AI Flight Deck shortcut on the desktop?")) {
        New-DesktopShortcut
    }

    Write-Host ""
    Write-Host "Setup is complete." -ForegroundColor Green
    Write-Host "The live scanner is read-only. Microsoft sign-in happens after you select 'Connect and scan tenant'."

    if (-not $SkipLaunch) {
        if ($alreadyRunning) {
            Start-Process $appUrl
        }
        else {
            Write-Host "Starting AI Flight Deck..." -ForegroundColor Cyan
            Start-Process -FilePath (Join-Path $PSScriptRoot "Start-AI-Flight-Deck.cmd") `
                -WorkingDirectory $PSScriptRoot
        }
    }
}
catch {
    Write-Host ""
    Write-Host "SETUP STOPPED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Nothing in the Microsoft 365 tenant was changed."
    exit 1
}
