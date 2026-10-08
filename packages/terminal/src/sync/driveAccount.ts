/** Signs the terminal in to and out of Google Drive, keeping the sync status in step. */
import type { ILogger, SyncCoordinator } from "@labshelf/core";

import type { CliDriveAuth, LoginOptions } from "./driveAuth.js";

export class DriveAccount {
  constructor(
    private readonly auth: CliDriveAuth,
    private readonly sync: SyncCoordinator,
    private readonly logger: ILogger,
  ) {}

  /**
   * Signs in through the browser.
   * @returns void
   */
  async login(options: LoginOptions): Promise<void> {
    await this.auth.login(options);
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
