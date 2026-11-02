// Names the relay's endpoints (share paths included), refusal codes and the constants the owner's account and its Worker share.

// CONTRACT: documents/contracts/relay.md#endpoints
export const RELAY_PATH = {
  version: "/version", claim: "/claim", ticket: "/ticket", project: "/project/", inbox: "/inbox", inboxItem: "/inbox/",
} as const;

export const RELAY_REFUSAL = {
  malformed: "malformed", incompatibleVersion: "incompatibleVersion", unauthorized: "unauthorized", forbidden: "forbidden", claimed: "claimed",
  tooLarge: "tooLarge", inboxFull: "inboxFull", rateLimited: "rateLimited",
} as const;

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
export const SHARE_PATH = {
  prefix: "/share/",
  manifest: (shareId: string) => `/share/${shareId}/manifest`,
  blob: (shareId: string, hash: string) => `/share/${shareId}/blob/${hash}`,
} as const;

export const SHARE_REFUSAL = { notFound: "notFound", tooLarge: "tooLarge" } as const;

const WORKER_NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const WORKER_NAME_LENGTH = 12;

// CONTRACT: documents/contracts/relay.md#deploy
/** A random Worker script name `ls-<12 lowercase base32 chars>`; it also names the Worker's address, which then cannot be guessed. */
export function createWorkerName(): string {
  // 256 is a multiple of 32, so masking each byte keeps every character equally likely.
  const bytes = crypto.getRandomValues(new Uint8Array(WORKER_NAME_LENGTH));
  return `ls-${Array.from(bytes, (byte) => WORKER_NAME_ALPHABET[byte & 31]).join("")}`;
}

/** One Durable Object migration step; Cloudflare applies the steps after the Worker's tag, in order. */
export interface RelayMigration {
  tag: string;
  new_sqlite_classes?: string[];
  renamed_classes?: { from: string; to: string }[];
  deleted_classes?: string[];
}

// INVARIANT: append only. A deployed Worker reports the last tag of the list it was bundled with, and an update sends the steps after it.
export const RELAY_MIGRATIONS: readonly RelayMigration[] = [
  { tag: "v1", new_sqlite_classes: ["Room"] },
  { tag: "v2", new_sqlite_classes: ["Inbox"] },
];

/** The tag of the last migration in `migrations`, which a Worker bundled with them has applied. */
export const lastMigrationTag = (migrations: readonly RelayMigration[]): string | undefined => migrations.at(-1)?.tag;
export const RELAY_ACCOUNT_LOG_MODULE = "relay";
