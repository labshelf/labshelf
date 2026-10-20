// Signs the user in to GitHub through VS Code's built-in authentication and hands back a token for one submission.
import * as vscode from "vscode";

import type { GitHubSignIn } from "@labshelf/core";

/** Opening a pull request on the catalog needs `public_repo`; the token is used for that call and never stored here. */
export async function signInToGitHub(): Promise<GitHubSignIn> {
  const session = await vscode.authentication.getSession("github", ["public_repo"], { createIfNone: true });
  return { token: session.accessToken, login: session.account.label };
}
