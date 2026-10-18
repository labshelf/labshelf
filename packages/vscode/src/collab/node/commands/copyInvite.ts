// Copies a share's invite link to the clipboard and shows it, without waiting for the message.
import * as vscode from "vscode";

export async function copyInvite(link: string, project: string): Promise<void> {
  await vscode.env.clipboard.writeText(link);
  void vscode.window.showInformationMessage(
    `Invite link for "${project}" copied. Anyone with it can read and edit the project, so send it only to collaborators: ${link}`,
  );
}
