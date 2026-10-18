// Tells whether the desktop-only commands are registered, which they are not on the web host.
import * as vscode from "vscode";

export const desktopCommandsAvailable = (): boolean => vscode.env.uiKind !== vscode.UIKind.Web;
