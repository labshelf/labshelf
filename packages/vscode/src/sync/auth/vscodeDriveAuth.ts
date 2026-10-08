/** Builds the extension's Google Drive sign-in: the bundled OAuth client, SecretStorage tokens and the VS Code browser. */
import type * as vscode from "vscode";

import { resolveOAuthClient, type ILogger } from "@labshelf/core";
import { PkceLoopbackAuth } from "@labshelf/core/node";

import { CLIENT_ID, CLIENT_SECRET } from "./googleDriveCredentials.js";
import { openAuthorizationUrl } from "./openAuthorizationUrl.js";
import { SecretStorageTokenStore } from "./secretStorageTokenStore.js";

/** @returns the Drive auth of the extension */
export function createVscodeDriveAuth(context: vscode.ExtensionContext, logger: ILogger): PkceLoopbackAuth {
  return new PkceLoopbackAuth(
    resolveOAuthClient(process.env, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    new SecretStorageTokenStore(context.secrets),
    fetch,
    {
      openBrowser: openAuthorizationUrl,
      logger,
      signInHint: 'Run "LabShelf: Sync: Connect to Google Drive" to sign in.',
    },
  );
}
