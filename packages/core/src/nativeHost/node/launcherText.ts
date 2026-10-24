/** Writes the script that browsers start as a native host: the bundled host script run by a fixed Node binary. */
import type { ScriptLaunch } from "./nativeHostEnv.js";

export function launcherScript(platform: NodeJS.Platform, launch: ScriptLaunch): string {
  return platform === "win32" ? windowsLauncher(launch) : shellLauncher(launch);
}

function shellLauncher({ nodePath, hostScript, electronRunAsNode }: ScriptLaunch): string {
  const prefix = electronRunAsNode ? "ELECTRON_RUN_AS_NODE=1 " : "";
  // Chrome passes the caller origin as an argument, so "$@" forwards it.
  return `#!/bin/sh\n${prefix}exec ${shellQuote(nodePath)} ${shellQuote(hostScript)} "$@"\n`;
}

function windowsLauncher({ nodePath, hostScript, electronRunAsNode }: ScriptLaunch): string {
  const env = electronRunAsNode ? "set ELECTRON_RUN_AS_NODE=1\r\n" : "";
  // PLATFORM: cmd.exe reads the script in the OEM code page; switching to UTF-8 first keeps non-ASCII paths intact.
  return `@chcp 65001>nul\r\n@echo off\r\n${env}${cmdQuote(nodePath)} ${cmdQuote(hostScript)} %*\r\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// TRAP: cmd expands %name% even inside double quotes; Windows paths cannot contain a double quote.
function cmdQuote(value: string): string {
  return `"${value.replace(/%/g, "%%")}"`;
}
