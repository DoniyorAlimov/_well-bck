#Requires -Version 5.1
<#
Provisions (or reuses) a self-signed TLS certificate for this machine in
Cert:\LocalMachine\My and exports it to cert\active.pfx (with its
DPAPI-protected passphrase in the sidecar file cert\active.pfx.passphrase)
for the production (`npm start`) HTTPS listener in index.ts to consume.

This is the BOOTSTRAP path only. Replacing the active cert with a CA-issued
one later is done through Admin Console -> TLS Certificate (see
routes/adminTlsCert.ts), which operates purely on the PFX file and never
touches the Windows certificate store or requires elevation.

Safe to re-run: reuses an existing non-expired WELLAPM_CERT for this
hostname instead of creating a duplicate. Pass -Force to always issue a new
certificate (replacing any existing WELLAPM_CERT for this hostname, even a
still-valid one) - e.g. after this script's own passphrase file was lost,
or to rotate ahead of expiry.

Must run elevated (Cert:\LocalMachine\My writes + private key export
require Administrator).
#>

param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    Write-Error 'This script must be run as Administrator (writes to Cert:\LocalMachine\My and exports a private key).'
    exit 1
}

$repoDir = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $repoDir 'cert'
$pfxPath = Join-Path $certDir 'active.pfx'
$passphrasePath = Join-Path $certDir 'active.pfx.passphrase'

# --- Determine hostname / DNS names -------------------------------------
$shortName = $env:COMPUTERNAME
$dnsNames = @($shortName)

try {
    $fqdn = [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName()).HostName
    if ($fqdn -and $fqdn -ne $shortName -and ($dnsNames -notcontains $fqdn)) {
        $dnsNames += $fqdn
    }
} catch {
    Write-Host "Could not resolve an FQDN for this machine; using short hostname only. ($($_.Exception.Message))"
}

Write-Host "Using DNS names: $($dnsNames -join ', ')"

# --- Reuse an existing valid cert for this host, unless -Force -----------
$matchingCerts = @(Get-ChildItem -Path Cert:\LocalMachine\My | Where-Object {
    $_.FriendlyName -eq 'WELLAPM_CERT' -and ($_.DnsNameList.Unicode -contains $shortName)
})

$existing = $null
if (-not $Force) {
    $existing = $matchingCerts |
        Where-Object { $_.NotAfter -gt (Get-Date) } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1
}

$certChanged = $false

if ($existing) {
    $cert = $existing
    Write-Host "Reusing existing certificate. Thumbprint: $($cert.Thumbprint), NotAfter: $($cert.NotAfter)"
} else {
    if ($Force) {
        Write-Host "-Force specified; replacing any existing WELLAPM_CERT for '$shortName'."
    } else {
        Write-Host "No valid WELLAPM_CERT found for '$shortName'; creating a new one."
    }

    # Clean up superseded certs (expired ones left from before, or the
    # still-valid one being forced out) from both stores so replacement
    # doesn't accumulate old entries.
    foreach ($old in $matchingCerts) {
        Write-Host "Removing superseded certificate. Thumbprint: $($old.Thumbprint)"
        Remove-Item -Path "Cert:\LocalMachine\My\$($old.Thumbprint)" -Force
        $oldRoot = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $old.Thumbprint }
        if ($oldRoot) {
            Remove-Item -Path "Cert:\LocalMachine\Root\$($old.Thumbprint)" -Force
        }
    }

    $cert = New-SelfSignedCertificate `
        -FriendlyName 'WELLAPM_CERT' `
        -DnsName $dnsNames `
        -CertStoreLocation 'Cert:\LocalMachine\My' `
        -Provider 'Microsoft Strong Cryptographic Provider' `
        -HashAlgorithm SHA256 `
        -KeyLength 4096 `
        -KeyExportPolicy Exportable `
        -KeyUsage DigitalSignature, KeyEncipherment, DataEncipherment `
        -KeyAlgorithm RSA `
        -NotAfter (Get-Date).AddMonths(120)
    Write-Host "Created certificate. Thumbprint: $($cert.Thumbprint), NotAfter: $($cert.NotAfter)"
    $certChanged = $true
}

# --- Trust it locally (this server trusting its own cert) ----------------
# This only makes THIS machine trust the certificate. Other client machines
# browsing to this server over HTTPS still need the cert distributed to
# their own trust stores separately (e.g. via GPO) - out of scope here.
$rootStore = Get-Item Cert:\LocalMachine\Root
$rootStore.Open('ReadWrite')
try {
    if (-not (Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })) {
        $rootStore.Add($cert)
        Write-Host 'Added certificate to Cert:\LocalMachine\Root (local trust).'
    }
} finally {
    $rootStore.Close()
}

# --- Export to PFX --------------------------------------------------------
New-Item -ItemType Directory -Path $certDir -Force | Out-Null

# This script runs elevated, so without this, Export-PfxCertificate below
# leaves active.pfx readable-only (RX) by BUILTIN\Users - not writable. That
# would break the Admin Console -> TLS Certificate upload/replace flow
# (which deliberately runs as whatever normal, non-elevated account starts
# the backend): fs.renameSync onto the existing active.pfx would fail with
# EPERM. Granting Modify here, with inheritance, so both this export and
# any future one - by this script or by the app's own replace-the-active-
# cert code - land writable by that same normal account.
icacls $certDir /grant 'BUILTIN\Users:(OI)(CI)(M)' | Out-Null

if (Test-Path $pfxPath) {
    Remove-Item $pfxPath -Force
}

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$passphraseBytes = New-Object byte[] 32
$rng.GetBytes($passphraseBytes)
$passphrase = [Convert]::ToBase64String($passphraseBytes)
$securePassphrase = ConvertTo-SecureString -String $passphrase -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassphrase | Out-Null
# Belt-and-suspenders: Export-PfxCertificate has been observed setting an
# explicit ACL on the new file rather than fully relying on the directory's
# inherited grant above, so re-assert it directly on the file too.
icacls $pfxPath /grant 'BUILTIN\Users:(M)' | Out-Null
Write-Host "Exported PFX to $pfxPath"

# --- DPAPI-protect the passphrase, write the sidecar file ----------------
# Same Add-Type/ProtectedData/LocalMachine-scope call as lib/dpapi.ts's
# dpapiProtect(), so the resulting ciphertext is directly readable by
# dpapiUnprotect() at app startup - including under an NSSM service account
# with no loaded user profile.
Add-Type -AssemblyName System.Security
$plainBytes = [System.Text.Encoding]::UTF8.GetBytes($passphrase)
$protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
    $plainBytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
$protectedPassphrase = [Convert]::ToBase64String($protectedBytes)

Set-Content -Path $passphrasePath -Value $protectedPassphrase -NoNewline
icacls $passphrasePath /grant 'BUILTIN\Users:(M)' | Out-Null
Write-Host "Wrote passphrase sidecar to $passphrasePath"

Write-Host ''
Write-Host 'Done.'
Write-Host "  Hostname/DNS names : $($dnsNames -join ', ')"
Write-Host "  Thumbprint         : $($cert.Thumbprint)"
Write-Host "  PFX path           : $pfxPath"

if ($certChanged) {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host '  A new certificate was installed - restart the backend now:'
    Write-Host '    npm start'
    Write-Host '  (or restart the Windows service, via windows/nssm.exe)'
    Write-Host '============================================================'
}
