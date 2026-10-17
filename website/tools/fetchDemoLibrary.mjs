// Copies the demo library to a destination folder and downloads the paper PDFs it does not ship from arXiv.
// Usage: node website/tools/fetchDemoLibrary.mjs <dest>
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = join(dirname(fileURLToPath(import.meta.url)), "..", "demo-library");
// The sidecar highlights are positioned on these versions of the PDF.
const PINNED_VERSIONS = { "2302.13971": "v1" };
const NOT_LIBRARY = new Set(["LICENSES.md"]);

const dest = process.argv[2];
if (!dest) {
  console.error("Usage: node fetchDemoLibrary.mjs <dest>");
  process.exit(2);
}

await cp(source, dest, { recursive: true, filter: (from) => !NOT_LIBRARY.has(from.slice(source.length + 1)) });

const exists = (path) => stat(path).then(() => true, () => false);

async function* paperFolders(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = join(dir, entry.name);
    if (await exists(join(folder, "metadata.yaml"))) yield folder;
    else yield* paperFolders(folder);
  }
}

async function download(arxivId, target, paperId) {
  const url = `https://arxiv.org/pdf/${arxivId}${PINNED_VERSIONS[arxivId] ?? ""}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${paperId}: ${url} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error(`${paperId}: ${url} did not return a PDF`);
  await writeFile(target, bytes);
}

let fetched = 0;
let present = 0;
for await (const folder of paperFolders(join(dest, "papers"))) {
  const paperId = folder.split("/").pop();
  const target = join(folder, "paper.pdf");
  if (await exists(target)) { present += 1; continue; }
  const arxivId = /arxiv\.org\/abs\/([\d.]+)/.exec(await readFile(join(folder, "metadata.yaml"), "utf8"))?.[1];
  if (!arxivId) throw new Error(`${paperId}: metadata.yaml has no arXiv url`);
  await mkdir(folder, { recursive: true });
  await download(arxivId, target, paperId);
  fetched += 1;
  console.log(`fetched ${paperId} (${arxivId})`);
}
console.log(`demo library at ${dest}: ${fetched} downloaded, ${present} already present`);
