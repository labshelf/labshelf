/** Turns the Google OAuth client in `credentials/` into esbuild defines, so each app bundles its client at build time. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const credentialsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../credentials");

/** @param {"desktop" | "web"} clientType */
export function googleCredentialDefines(clientType) {
  const client = process.env["LABSHELF_GOOGLE_CLIENT_ID"]
    ? { clientId: process.env["LABSHELF_GOOGLE_CLIENT_ID"], clientSecret: process.env["LABSHELF_GOOGLE_CLIENT_SECRET"] }
    : readClient(clientType);
  // The web client is public: its build never carries a secret.
  const secret = clientType === "desktop" ? (client.clientSecret ?? "") : "";
  return {
    __LABSHELF_GOOGLE_CLIENT_ID__: JSON.stringify(client.clientId ?? ""),
    __LABSHELF_GOOGLE_CLIENT_SECRET__: JSON.stringify(secret),
  };
}

function readClient(clientType) {
  const file = resolve(credentialsDir, `google-${clientType}.json`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    // A build without credentials still works; sync then reports the client as not configured.
    console.error(`[labshelf] ${file} not readable (${error.code ?? error.message}); building without a Google client.`);
    return { clientId: "", clientSecret: "" };
  }
}
