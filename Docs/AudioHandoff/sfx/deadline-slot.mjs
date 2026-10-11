import {spawnSync} from 'node:child_process';
export function foreignBrowserOwners(parentPID=process.pid){
 const script="@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -in @('chrome.exe','chrome-headless-shell.exe','HardBurn.exe','UnrealEditor-CEFSubProcess.exe')) -and ($_.CommandLine -notmatch '--type=') -and ($_.Name -ne 'chrome.exe' -or $_.CommandLine -match '--headless') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress";
 const audit=spawnSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000});if(audit.status||audit.error)throw Error('Browser ownership audit failed');
 const value=audit.stdout.trim()?JSON.parse(audit.stdout):[],rows=Array.isArray(value)?value:[value];return rows.filter(x=>x.ParentProcessId!==parentPID);
}
