#Requires -Version 5.1
<#
Loads a PFX purely in memory (X509KeyStorageFlags.EphemeralKeySet - never
touches any Windows certificate store or persistent key container, so this
never needs Administrator) and reports its metadata as one line of compact
JSON on stdout, for lib/pfxInspect.ts to consume.

Path and passphrase come in via environment variables (PFX_INSPECT_PATH /
PFX_INSPECT_PASSPHRASE), not CLI args, matching lib/dpapi.ts's existing
anti-injection / no-secret-in-process-listing precaution.

A wrong password or corrupt file is reported as {"ok":false,"error":...}
data on stdout, not a thrown error / non-zero exit - the caller decides
what a validation failure means, this script only inspects.

SAN DNS names are extracted by hand-parsing the extension's raw DER bytes
rather than X509Extension.Format(), which renders its "DNS Name=" labels in
the OS's UI language - unsafe to string-match on a non-English Windows host.
Enhanced Key Usage doesn't have this problem: .NET's X509Certificate2
already returns a typed X509EnhancedKeyUsageExtension with a structured
EnhancedKeyUsages OID collection.
#>

$ErrorActionPreference = 'Stop'

function Read-Asn1Length {
    param([byte[]]$Bytes, [int]$Offset)
    $first = $Bytes[$Offset]
    if ($first -lt 0x80) {
        return @{ Length = [int]$first; NextOffset = $Offset + 1 }
    }
    $numBytes = $first -band 0x7F
    $length = 0
    for ($i = 0; $i -lt $numBytes; $i++) {
        $length = ($length -shl 8) -bor $Bytes[$Offset + 1 + $i]
    }
    return @{ Length = $length; NextOffset = $Offset + 1 + $numBytes }
}

function Get-SanDnsNames {
    param([byte[]]$RawData)
    $dnsNames = @()
    if (-not $RawData -or $RawData.Length -lt 2) {
        return $dnsNames
    }
    # Outer GeneralNames SEQUENCE: tag byte at [0], length starts at [1].
    $outerLen = Read-Asn1Length -Bytes $RawData -Offset 1
    $pos = $outerLen.NextOffset
    $end = [Math]::Min($pos + $outerLen.Length, $RawData.Length)
    while ($pos -lt $end) {
        $entryTag = $RawData[$pos]
        $entryLen = Read-Asn1Length -Bytes $RawData -Offset ($pos + 1)
        $contentStart = $entryLen.NextOffset
        $contentLen = $entryLen.Length
        # dNSName is GeneralName's context-specific, primitive tag 2: 0x80 | 0x02.
        if ($entryTag -eq 0x82 -and $contentLen -gt 0) {
            $nameBytes = $RawData[$contentStart..($contentStart + $contentLen - 1)]
            $dnsNames += [System.Text.Encoding]::ASCII.GetString($nameBytes)
        }
        $pos = $contentStart + $contentLen
    }
    return $dnsNames
}

# Built by hand rather than ConvertTo-Json: Windows PowerShell 5.1's
# ConvertTo-Json turns an empty/single-element array into {} or a bare
# scalar instead of [...], which would fail a strict array parse on the
# Node side. A fixed, small schema like this is safer done manually.
function ConvertTo-JsonString {
    param([string]$Value)
    if ($null -eq $Value) { return '""' }
    $escaped = $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n')
    return '"' + $escaped + '"'
}

function ConvertTo-JsonStringArray {
    param([string[]]$Items)
    if (-not $Items -or $Items.Count -eq 0) { return '[]' }
    return '[' + (($Items | ForEach-Object { ConvertTo-JsonString $_ }) -join ',') + ']'
}

function Write-FailureResult {
    param([string]$ErrorMessage)
    Write-Output ('{"ok":false,"error":' + (ConvertTo-JsonString $ErrorMessage) + '}')
}

$path = $env:PFX_INSPECT_PATH
$passphrase = $env:PFX_INSPECT_PASSPHRASE

if (-not $path -or -not (Test-Path $path)) {
    Write-FailureResult 'PFX file not found.'
    exit 0
}

try {
    $securePassphrase = ConvertTo-SecureString -String $passphrase -Force -AsPlainText
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
        $path, $securePassphrase, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
} catch {
    Write-FailureResult $_.Exception.Message
    exit 0
}

$sanExt = $cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' } | Select-Object -First 1
$dnsNames = if ($sanExt) { @(Get-SanDnsNames -RawData $sanExt.RawData) } else { @() }

$ekuExt = $cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | Select-Object -First 1
$hasServerAuthEku = $true
if ($ekuExt) {
    $eku = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$ekuExt
    $hasServerAuthEku = $false
    foreach ($oid in $eku.EnhancedKeyUsages) {
        if ($oid.Value -eq '1.3.6.1.5.5.7.3.1') {
            $hasServerAuthEku = $true
        }
    }
}

$hasPrivateKeyJson = if ($cert.HasPrivateKey) { 'true' } else { 'false' }
$hasServerAuthEkuJson = if ($hasServerAuthEku) { 'true' } else { 'false' }

$json = '{' +
    '"ok":true' +
    ',"hasPrivateKey":' + $hasPrivateKeyJson +
    ',"notBefore":' + (ConvertTo-JsonString $cert.NotBefore.ToUniversalTime().ToString('o')) +
    ',"notAfter":' + (ConvertTo-JsonString $cert.NotAfter.ToUniversalTime().ToString('o')) +
    ',"subject":' + (ConvertTo-JsonString $cert.Subject) +
    ',"dnsNames":' + (ConvertTo-JsonStringArray $dnsNames) +
    ',"hasServerAuthEku":' + $hasServerAuthEkuJson +
    ',"thumbprint":' + (ConvertTo-JsonString $cert.Thumbprint) +
    '}'

Write-Output $json
