#!/usr/bin/env bash
# Blocks Bash commands that kill VS Code, Electron or Chrome by name, or launch the installed VS Code app.
# PLATFORM: both closed every VS Code window the user had open, including the one running the session.
set -u
command=$(jq -r '.tool_input.command // empty')
deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
  exit 0
}
if printf '%s' "$command" | grep -qiE '(pkill|killall)[^|;&]*(code|electron|chrome)'; then
  deny "Stop only the PID you launched or the process with your unique --user-data-dir; never kill VS Code, Electron or Chrome by name."
fi
if printf '%s' "$command" | grep -qF '/Applications/Visual Studio Code.app'; then
  deny "Run checks on a VS Code copy downloaded by @vscode/test-electron, never the installed app"
fi
exit 0
