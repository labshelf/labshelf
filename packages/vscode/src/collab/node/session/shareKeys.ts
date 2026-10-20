// Keeps each share's invite in VS Code's SecretStorage, so the key never lands in the library or in settings.
import type * as vscode from "vscode";

import { formatInvite, parseInvite, type ILogger, type ShareKeyStore, type StoredInvite } from "@labshelf/core";

const secretName = (shareId: string): string => `labshelf.collab.invite.${shareId}`;

/** Stores each share as its invite link, which holds the share key and the relays. */
export class ShareKeys implements ShareKeyStore {
  constructor(private readonly secrets: vscode.SecretStorage, private readonly logger: ILogger) {}

  async remember({ shareId, shareKey, relays }: StoredInvite): Promise<void> {
    await this.secrets.store(secretName(shareId), await formatInvite({ shareKey, relays }));
  }

  async invite(shareId: string): Promise<StoredInvite | undefined> {
    const link = await this.secrets.get(secretName(shareId));
    if (!link) { return undefined; }
    const parsed = await parseInvite(link);
    if (parsed.ok && parsed.invite.shareId === shareId) { return parsed.invite; }
    void this.logger.log("WARN", "collab", "Dropped a stored invite that does not parse", { shareId, error: parsed.ok ? "otherShare" : parsed.error });
    await this.forget(shareId);
    return undefined;
  }

  async forget(shareId: string): Promise<void> {
    await this.secrets.delete(secretName(shareId));
  }
}
