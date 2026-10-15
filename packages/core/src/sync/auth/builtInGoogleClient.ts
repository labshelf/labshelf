/** Exposes the Google OAuth client each app's build injects from `credentials/` (empty in tests and unconfigured builds). */
import type { OAuthClient } from "./oauthClient.js";

declare const __LABSHELF_GOOGLE_CLIENT_ID__: string | undefined;
declare const __LABSHELF_GOOGLE_CLIENT_SECRET__: string | undefined;

export const BUILT_IN_GOOGLE_CLIENT: OAuthClient = {
  clientId: typeof __LABSHELF_GOOGLE_CLIENT_ID__ === "undefined" ? "" : __LABSHELF_GOOGLE_CLIENT_ID__,
  clientSecret: typeof __LABSHELF_GOOGLE_CLIENT_SECRET__ === "undefined" ? "" : __LABSHELF_GOOGLE_CLIENT_SECRET__,
};
