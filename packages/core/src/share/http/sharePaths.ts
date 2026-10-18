// Names the Worker's share endpoints and the refusal codes they add to the relay's.

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
export const SHARE_PATH = {
  prefix: "/share/",
  manifest: (shareId: string) => `/share/${shareId}/manifest`,
  blob: (shareId: string, hash: string) => `/share/${shareId}/blob/${hash}`,
} as const;

export const SHARE_REFUSAL = { notFound: "notFound", tooLarge: "tooLarge" } as const;
