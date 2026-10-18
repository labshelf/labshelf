// Wires the owner's Cloudflare relay on the desktop: the connect and disconnect commands and the update on start.
import * as vscode from "vscode";

import { connectRelay, CONNECT_RELAY_COMMAND } from "./connectRelay.js";
import { disconnectRelay, DISCONNECT_RELAY_COMMAND, type DisconnectDeps } from "./disconnectRelay.js";
import { updateRelayOnStart } from "./updateRelayOnStart.js";

export function registerRelay(context: vscode.ExtensionContext, deps: DisconnectDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(CONNECT_RELAY_COMMAND, () => connectRelay(deps)),
    vscode.commands.registerCommand(DISCONNECT_RELAY_COMMAND, () => disconnectRelay(deps)),
  );
  // Never awaited: activation does not wait on the network.
  void updateRelayOnStart(deps);
}
