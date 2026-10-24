// Fails when a directory under packages/*/src holds more than 8 source files directly.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT = 8;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const isSourceFile = (name) => /\.(ts|tsx|css)$/.test(name) && name !== "index.ts" && !name.endsWith(".d.ts");

function collectOffenders(dir, offenders) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const count = entries.filter((entry) => entry.isFile() && isSourceFile(entry.name)).length;
  if (count > LIMIT) offenders.push([relative(root, dir), count]);
  for (const entry of entries) {
    if (entry.isDirectory()) collectOffenders(join(dir, entry.name), offenders);
  }
}

const offenders = [];
for (const pkg of readdirSync(join(root, "packages"))) {
  const src = join(root, "packages", pkg, "src");
  if (existsSync(src)) collectOffenders(src, offenders);
}

for (const [dir, count] of offenders) {
  console.error(`${dir} holds ${count} source files (limit ${LIMIT}). Group them into subfolders.`);
}
console.log(`directory size: ${offenders.length} directories over ${LIMIT} files`);
process.exit(offenders.length > 0 ? 1 : 0);
