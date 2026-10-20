// Bundles the core UI for the standalone mockup.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ["core.ts"],
  bundle: true,
  format: "iife",
  globalName: "CoreUI",
  outdir: ".generated",
  legalComments: "none",
  banner: { js: `/*${await readFile(new URL("../LICENSE", import.meta.resolve("boring-avatars-vanilla")), "utf8")}*/` },
});
