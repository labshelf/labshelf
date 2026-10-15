/** Builds the extension's Google Drive sign-in: the bundled OAuth client, SecretStorage tokens and the VS Code browser. */
import type * as vscode from "vscode";

import { BUILT_IN_GOOGLE_CLIENT, resolveOAuthClient, type ILogger } from "@labshelf/core";
import { PkceLoopbackAuth } from "@labshelf/core/node";

import { openAuthorizationUrl, SecretStorageTokenStore } from "../auth/index.js";

/** @returns the Drive auth of the extension */
export function createVscodeDriveAuth(context: vscode.ExtensionContext, logger: ILogger): PkceLoopbackAuth {
  return new PkceLoopbackAuth(
    resolveOAuthClient(process.env, BUILT_IN_GOOGLE_CLIENT),
    new SecretStorageTokenStore(context.secrets),
    fetch,
    {
      openBrowser: openAuthorizationUrl,
      logger,
      signInHint: 'Run "LabShelf: Sync: Connect to Google Drive" to sign in.',
    },
  );
}
