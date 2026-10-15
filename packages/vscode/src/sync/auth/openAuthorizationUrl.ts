/** Opens the Google sign-in page in the user's browser, and offers the link when the browser does not open. */
import * as vscode from "vscode";

const COPY_LINK = "Copy Link";

async function offerSignInLink(url: string): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "LabShelf: could not open the browser for Google sign-in. Copy the link and open it yourself.",
    COPY_LINK,
  );
  if (choice === COPY_LINK) { await vscode.env.clipboard.writeText(url); }
}

/**
 * A failure of openExternal propagates (the auth logs it and keeps waiting); the link is offered either way.
 */
export async function openAuthorizationUrl(url: string): Promise<void> {
  let opened = false;
  try {
    opened = await vscode.env.openExternal(vscode.Uri.parse(url));
  } finally {
    if (!opened) { void offerSignInLink(url); }
  }
}
