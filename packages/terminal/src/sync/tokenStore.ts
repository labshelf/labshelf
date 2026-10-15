// Stores the terminal's Google Drive tokens: macOS Keychain, Secret Service (secret-tool), else a 0600 file.
// LABSHELF_TOKEN_STORE=file forces the file.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseTokens, type TokenData, type TokenStore } from "@labshelf/core";
import { sharedConfigDir } from "@labshelf/core/node";

// PLATFORM: VS Code's SecretStorage is unreadable by other processes, so the terminal signs in on its own
// (same Google account and OAuth client, hence the same Drive files).

import { hasCommand } from "../platform/index.js";

const SERVICE = "labshelf.gdrive.tokens";

/** Tokens in a JSON file readable only by the user. */
export class FileTokenStore implements TokenStore {
  readonly kind = "file" as const;

  constructor(readonly file = path.join(sharedConfigDir(), "credentials.json")) {}

  async load(): Promise<TokenData | null> {
    try {
      return parseTokens(await fs.readFile(this.file, "utf8"));
    } catch {
      return null;
    }
  }

  async save(tokens: TokenData): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tokens), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    await fs.chmod(this.file, 0o600);
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}

/** macOS login Keychain through /usr/bin/security. */
class KeychainTokenStore implements TokenStore {
  readonly kind = "keychain" as const;
  private readonly account = os.userInfo().username;

  async load(): Promise<TokenData | null> {
    const result = spawnSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", this.account, "-w"], {
      encoding: "utf8",
    });
    return result.status === 0 ? parseTokens(result.stdout.trim()) : null;
  }

  async save(tokens: TokenData): Promise<void> {
    const result = spawnSync(
      "/usr/bin/security",
      ["add-generic-password", "-U", "-s", SERVICE, "-a", this.account, "-l", "LabShelf Google Drive", "-w", JSON.stringify(tokens)],
      { encoding: "utf8" },
    );
    if (result.status !== 0) { throw new Error(`Keychain write failed: ${result.stderr.trim() || result.status}`); }
  }

  async clear(): Promise<void> {
    spawnSync("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", this.account], { encoding: "utf8" });
  }
}

/** freedesktop Secret Service (GNOME Keyring, KWallet) through secret-tool; the secret goes over stdin. */
class SecretServiceTokenStore implements TokenStore {
  readonly kind = "secret-service" as const;

  async load(): Promise<TokenData | null> {
    const result = spawnSync("secret-tool", ["lookup", "service", SERVICE], { encoding: "utf8" });
    return result.status === 0 ? parseTokens(result.stdout.trim()) : null;
  }

  async save(tokens: TokenData): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("secret-tool", ["store", "--label=LabShelf Google Drive", "service", SERVICE], {
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`secret-tool failed: ${stderr.trim() || code}`))));
      child.stdin.end(JSON.stringify(tokens));
    });
  }

  async clear(): Promise<void> {
    spawnSync("secret-tool", ["clear", "service", SERVICE], { encoding: "utf8" });
  }
}

/**
 * Picks the most secure store available.
 * @returns the store
 */
export function createTokenStore(env: NodeJS.ProcessEnv = process.env): TokenStore {
  const file = path.join(sharedConfigDir(env), "credentials.json");
  if (env["LABSHELF_TOKEN_STORE"] === "file") { return new FileTokenStore(file); }
  if (process.platform === "darwin" && existsSync("/usr/bin/security")) { return new KeychainTokenStore(); }
  if (process.platform === "linux" && hasCommand("secret-tool", env) && env["DBUS_SESSION_BUS_ADDRESS"]) {
    return new SecretServiceTokenStore();
  }
  return new FileTokenStore(file);
}
