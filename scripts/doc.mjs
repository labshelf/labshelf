// Prints one section of a document in documents/, or the headings of a document, so agents never load a whole doc.
// Usage: node scripts/doc.mjs                 lists the documents and what each is for
//        node scripts/doc.mjs <doc>           lists the headings of documents/<doc>.md with their anchors
//        node scripts/doc.mjs <doc>#<anchor>  prints that section, subsections included
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "documents");
// Plans and ideas are read through their own files, never through this script.
const SKIPPED = new Set(["plans", "ideas"]);

export const slugify = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const headingOf = (line) => line.match(/^(#{1,6})\s+(.*)$/);

export function listHeadings(text) {
  return text
    .split("\n")
    .map(headingOf)
    .filter(Boolean)
    .map(([, hashes, title]) => `${"  ".repeat(hashes.length - 1)}${title}  #${slugify(title)}`);
}

export function extractSection(text, anchor) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => {
    const heading = headingOf(line);
    return heading && slugify(heading[2]) === anchor;
  });
  if (start < 0) return null;
  const level = headingOf(lines[start])[1].length;
  const end = lines.findIndex((line, i) => {
    const heading = i > start && headingOf(line);
    return heading && heading[1].length <= level;
  });
  return lines.slice(start, end < 0 ? undefined : end).join("\n").trimEnd();
}

function listDocuments(dir = docsRoot, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED.has(entry.name)) listDocuments(path, out);
    } else if (entry.name.endsWith(".md")) {
      const purpose = readFileSync(path, "utf8").split("\n").find((line) => line.startsWith("Read when")) ?? "";
      out.push(`${relative(docsRoot, path).replace(/\.md$/, "")}  ${purpose}`);
    }
  }
  return out;
}

function run(arg) {
  if (!arg) return { out: listDocuments().join("\n"), code: 0 };
  const [name, anchor] = arg.replace(/^documents\//, "").split("#");
  const file = join(docsRoot, name.endsWith(".md") ? name : `${name}.md`);
  if (!existsSync(file)) return { out: `No document ${name}. Run without arguments to list them.`, code: 1 };
  const text = readFileSync(file, "utf8");
  if (!anchor) return { out: listHeadings(text).join("\n"), code: 0 };
  const section = extractSection(text, anchor);
  if (section === null) return { out: `No section #${anchor} in ${name}. Headings:\n${listHeadings(text).join("\n")}`, code: 1 };
  return { out: section, code: 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { out, code } = run(process.argv[2]);
  (code === 0 ? console.log : console.error)(out);
  process.exit(code);
}
