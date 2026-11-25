param([Parameter(Mandatory=$true)][string]$Session)
$entry=Get-Content -LiteralPath $Session -Raw | ConvertFrom-Json
$owned=Get-Process -Id $entry.pid -ErrorAction Stop
if($owned.Path -ne $entry.exe){throw 'Diagnostic process path mismatch'}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OwnedViewerWindow {
 public delegate bool EnumCallback(IntPtr hwnd,IntPtr parameter);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback,IntPtr parameter);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int size);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd,int command);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 public static IntPtr Find(uint target) {
  IntPtr found=IntPtr.Zero;
  EnumWindows((handle,unused)=>{
   uint pid;GetWindowThreadProcessId(handle,out pid);
   if(pid!=target)return true;
   var title=new StringBuilder(512);GetWindowText(handle,title,title.Capacity);
   if(!title.ToString().StartsWith("IFC-Lite") || !IsWindowVisible(handle))return true;
   found=handle;return false;
  },IntPtr.Zero);
  return found;
 }
}
'@
$handle=[OwnedViewerWindow]::Find([uint32]$entry.pid)
if($handle -eq [IntPtr]::Zero){throw 'No owned IFC-Lite window'}
[void][OwnedViewerWindow]::ShowWindowAsync($handle,9)
Start-Sleep -Milliseconds 150
$activate=New-Object -ComObject WScript.Shell
$accepted=$false;$focused=$false
for($attempt=0;$attempt-lt 3-and -not $focused;$attempt++){
 [void]$activate.AppActivate([int]$entry.pid)
 Start-Sleep -Milliseconds 300
 $accepted=[OwnedViewerWindow]::SetForegroundWindow($handle)
 Start-Sleep -Milliseconds 300
 $focused=([OwnedViewerWindow]::GetForegroundWindow() -eq $handle)
}
@{pid=$entry.pid;exe=$entry.exe;accepted=$accepted;focused=$focused} | ConvertTo-Json
if(-not $focused){throw 'Owned viewer did not acquire foreground focus'}
