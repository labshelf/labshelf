// Bundles the core UI for the standalone mockup.
import { build } from "esbuild";
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
});
