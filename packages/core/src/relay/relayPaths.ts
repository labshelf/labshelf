// Names the relay's endpoints (share paths included), refusal codes and the constants the owner's account and its Worker share.

// CONTRACT: documents/contracts/relay.md#endpoints
export const RELAY_PATH = { version: "/version", claim: "/claim", ticket: "/ticket", project: "/project/" } as const;

export const RELAY_REFUSAL = {
  malformed: "malformed", incompatibleVersion: "incompatibleVersion", unauthorized: "unauthorized", forbidden: "forbidden", claimed: "claimed",
} as const;

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
export const SHARE_PATH = {
  prefix: "/share/",
  manifest: (shareId: string) => `/share/${shareId}/manifest`,
  blob: (shareId: string, hash: string) => `/share/${shareId}/blob/${hash}`,
} as const;

export const SHARE_REFUSAL = { notFound: "notFound", tooLarge: "tooLarge" } as const;

/** The Worker name in the owner's account, which also names its address. */
export const RELAY_WORKER_NAME = "labshelf-relay";
export const RELAY_ACCOUNT_LOG_MODULE = "relay";
