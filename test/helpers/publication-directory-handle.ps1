param([Parameter(Mandatory=$true)][string]$FixtureDirectory, [switch]$ShareDelete, [switch]$LockChild)
$ErrorActionPreference = 'Stop'
# Test-only synthetic directory handle. No application settings or privileges changed.
$fixtureRoot = [IO.Path]::GetFullPath($FixtureDirectory)
if (-not ([IO.Directory]::Exists($fixtureRoot)) -or -not ([IO.Path]::GetFileName($fixtureRoot).StartsWith('head-publication-lock-'))) { throw 'Not a synthetic lock fixture' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class PublicationDirectoryHandle {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
}
'@
$requestFile = [IO.Path]::Combine($fixtureRoot, 'request.json')
$releaseFile = [IO.Path]::Combine($fixtureRoot, 'release')
[IO.File]::WriteAllText([IO.Path]::Combine($fixtureRoot, 'ready'), 'ready')
$limit = [DateTime]::UtcNow.AddSeconds(20)
while (-not [IO.File]::Exists($requestFile)) {
  if ([IO.File]::Exists($releaseFile)) { exit 0 }
  if ([DateTime]::UtcNow -gt $limit) { throw 'Request deadline' }
  Start-Sleep -Milliseconds 10
}
$request = Get-Content -LiteralPath $requestFile -Raw | ConvertFrom-Json
$target = [IO.Path]::GetFullPath($request.directory)
$allowedParent = [IO.Path]::GetFullPath($request.fixtureParent)
if (-not ([IO.Path]::GetFileName($allowedParent).StartsWith('head-worker-integration-')) -or
    -not $target.StartsWith($allowedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([IO.Path]::GetFileName($target) -match '^\.execution-authorization-[a-f0-9]{24}\.[a-f0-9-]{36}\.tmp$')) { throw 'Not an exact synthetic staging directory' }
$share = 3
if ($ShareDelete) { $share = 7 }
if ($LockChild) { $target = [IO.Path]::Combine($target, 'draft.json') }
$handle = [PublicationDirectoryHandle]::CreateFile(('\\?\' + $target), 2147483648, $share, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero)
if ($handle.IsInvalid) { throw ('Open error: ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
try {
  [IO.File]::WriteAllText([IO.Path]::Combine($fixtureRoot, 'locked'), 'locked')
  while (-not [IO.File]::Exists($releaseFile)) {
    if ([DateTime]::UtcNow -gt $limit) { throw 'Release deadline' }
    Start-Sleep -Milliseconds 10
  }
} finally {
  $handle.Dispose()
  [IO.File]::WriteAllText([IO.Path]::Combine($fixtureRoot, 'released'), 'released')
}
