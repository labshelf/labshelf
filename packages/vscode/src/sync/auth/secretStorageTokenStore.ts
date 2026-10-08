/** Google tokens in VS Code's SecretStorage, as JSON under the fixed key that signed-in users already hold. */
import type * as vscode from "vscode";

import { parseTokens, type TokenData, type TokenStore } from "@labshelf/core";

const SECRET_KEY = "labshelf.gdrive.tokens";

export class SecretStorageTokenStore implements TokenStore {
  readonly kind = "secret-storage" as const;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async load(): Promise<TokenData | null> {
    return parseTokens(await this.secrets.get(SECRET_KEY));
  }

  async save(tokens: TokenData): Promise<void> {
    await this.secrets.store(SECRET_KEY, JSON.stringify(tokens));
  }

  async clear(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }
}
