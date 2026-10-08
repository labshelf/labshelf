/** Signs the terminal in to and out of Google Drive, keeping the sync status in step. */
import type { ILogger, SyncCoordinator } from "@labshelf/core";
import type { LoginPrompt, PkceLoopbackAuth } from "@labshelf/core/node";

export class DriveAccount {
  constructor(
    private readonly auth: PkceLoopbackAuth,
    private readonly sync: SyncCoordinator,
    private readonly logger: ILogger,
  ) {}

  /**
   * Signs in through the browser.
   * @returns void
   */
  async login(prompt: LoginPrompt): Promise<void> {
    await this.auth.login(prompt);
    this.sync.refreshAuth();
    await this.logger.log("INFO", "terminal/sync", "Signed in to Google Drive", { store: this.auth.storeKind });
  }

  /**
   * Signs out and forgets the tokens. The library and the manifest stay.
   * @returns void
   */
  async logout(): Promise<void> {
    await this.auth.revoke();
    this.sync.refreshAuth();
    await this.logger.log("INFO", "terminal/sync", "Signed out of Google Drive", {});
  }
}
