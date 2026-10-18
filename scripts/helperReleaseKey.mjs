// Generates the helper update signing key pair and signs a release's latest.json (Ed25519, base64 DER).
// Usage: `keygen` prints both keys; `sign <latest.json>` reads HELPER_UPDATE_KEY and writes <latest.json>.sig.
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [mode, file] = process.argv.slice(2);

if (mode === "keygen") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const privateB64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  process.stdout.write(`public (spki, goes in the helper source):\n${publicB64}\nprivate (pkcs8, store as HELPER_UPDATE_KEY):\n${privateB64}\n`);
} else if (mode === "sign" && file) {
  const encoded = process.env.HELPER_UPDATE_KEY;
  if (!encoded) { throw new Error("HELPER_UPDATE_KEY is not set"); }
  const key = createPrivateKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "pkcs8" });
  writeFileSync(`${file}.sig`, sign(null, readFileSync(file), key).toString("base64"));
} else {
  process.stderr.write("Usage: helperReleaseKey.mjs keygen | sign <latest.json>\n");
  process.exitCode = 2;
}
