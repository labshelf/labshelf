/** Signs the terminal in to and out of Google Drive, keeping the sync status in step. */
import type { ILogger, SyncCoordinator } from "@labshelf/core";
import type { LoginPrompt, PkceLoopbackAuth } from "@labshelf/core/node";

export type DriveAccount = ReturnType<typeof createDriveAccount>;

export function createDriveAccount(auth: PkceLoopbackAuth, sync: SyncCoordinator, logger: ILogger) {
  return {
    /** Signs in through the browser. */
    async login(prompt: LoginPrompt): Promise<void> {
      await auth.login(prompt);
      sync.refreshAuth();
      await logger.log("INFO", "terminal/sync", "Signed in to Google Drive", { store: auth.storeKind });
    },
    /** Signs out and forgets the tokens. The library and the manifest stay. */
    async logout(): Promise<void> {
      await auth.revoke();
      sync.refreshAuth();
      await logger.log("INFO", "terminal/sync", "Signed out of Google Drive", {});
    },
  };
}
