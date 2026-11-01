// Reads a project's outline, a section, figures or bibliography as text pages of at most 64 KB with a byte-offset cursor.
import { readLatexProjectTexts } from "../latex/sourceProject.js";
import { parseBibEntries } from "../writing/citations/bibliography.js";
import { findOutlineHeadings, type OutlineHeading } from "../writing/outline/outline.js";
import type { ReadyProject } from "../writing/project/projectEntry.js";
import { listProjectFiles, readOptionalText, type ProjectReadContext } from "../writing/project/projectReads.js";

type ProjectContextPart = "outline" | "section" | "figures" | "bibliography";

export interface ProjectContextRequest { part: ProjectContextPart; heading?: string; cursor?: string }

export interface ProjectContextPage { text: string; cursor?: string }

type ReadContext = Pick<ProjectReadContext, "fs" | "paths">;

const PAGE_BYTES = 65536;
const NO_MAIN = "No main file.";
const FIGURE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "pdf", "webp", "eps"]);
const BIB_FIELDS = ["title", "author", "year"];

interface ManuscriptFile { path: string; text: string; headings: OutlineHeading[] }

/** The main file and, for LaTeX, the files it reaches, in reading order; empty when there is no main file. */
async function readManuscript({ fs, paths }: ReadContext, project: ReadyProject): Promise<ManuscriptFile[]> {
  const main = project.main;
  if (main === undefined) return [];
  const read = (path: string): Promise<string | undefined> => readOptionalText(fs, paths.join(project.folder, path));
  const format = project.settings.format;
  const texts: Array<[string, string]> = [];
  if (format === "latex") texts.push(...(await readLatexProjectTexts(main, { read })).texts);
  else {
    const text = await read(main);
    if (text !== undefined) texts.push([main, text]);
  }
  return texts.map(([path, text]) => ({ path, text, headings: findOutlineHeadings(format, text) }));
}

function outlineText(files: readonly ManuscriptFile[]): string {
  const all = files.flatMap((file) => file.headings.map((heading) => ({ file: file.path, heading })));
  const smallest = Math.min(...all.map(({ heading }) => heading.level));
  return all.map(({ file, heading }) => `${"  ".repeat(heading.level - smallest)}${heading.title}  (${file}:${heading.line + 1})\n`).join("");
}

function sectionText(files: readonly ManuscriptFile[], wanted: string): string {
  for (const file of files) {
    const index = file.headings.findIndex((heading) => heading.title === wanted);
    if (index < 0) continue;
    const heading = file.headings[index]!;
    const next = file.headings.slice(index + 1).find((later) => later.level <= heading.level);
    const lines = file.text.split("\n");
    const from = lines.slice(0, heading.line).reduce((sum, line) => sum + line.length + 1, 0);
    const to = next === undefined ? file.text.length : lines.slice(0, next.line).reduce((sum, line) => sum + line.length + 1, 0);
    return file.text.slice(from, to);
  }
  return `No section titled "${wanted}".`;
}

async function figuresText(context: ReadContext, project: ReadyProject): Promise<string> {
  const isFigure = (path: string): boolean =>
    FIGURE_EXTENSIONS.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase()) && !path.startsWith("talks/") && !path.startsWith("posters/");
  const figures = (await listProjectFiles(context, project.folder)).filter(isFigure);
  const stats = await Promise.all(figures.map((path) => context.fs.stat(context.paths.join(project.folder, path))));
  return figures.map((path, index) => `${path}  ${stats[index]?.size ?? 0} bytes\n`).join("");
}

async function bibliographyText(context: ReadContext, project: ReadyProject): Promise<string> {
  const bibFiles = (await listProjectFiles(context, project.folder)).filter((path) => path.toLowerCase().endsWith(".bib"));
  let text = "";
  for (const path of bibFiles) {
    text += `# ${path}\n`;
    for (const entry of parseBibEntries(await readOptionalText(context.fs, context.paths.join(project.folder, path)) ?? "")) {
      text += `@${entry.type}{${entry.key}}\n`;
      for (const field of BIB_FIELDS) {
        const value = entry.fields.get(field);
        if (value !== undefined) text += `  ${field} = ${value.replace(/\s+/g, " ").trim()}\n`;
      }
    }
  }
  return text;
}

async function partText(context: ReadContext, project: ReadyProject, request: ProjectContextRequest): Promise<string> {
  if (request.part === "figures") return figuresText(context, project);
  if (request.part === "bibliography") return bibliographyText(context, project);
  const files = await readManuscript(context, project);
  if (files.length === 0) return `${NO_MAIN}\n`;
  return request.part === "outline" ? outlineText(files) : sectionText(files, (request.heading ?? "").trim());
}

const isContinuation = (byte: number): boolean => (byte & 0xc0) === 0x80;

/** The end of the page starting at `start`: after the last line break inside the limit, else at the last code point boundary inside it. */
function pageEnd(bytes: Uint8Array, start: number): number {
  const limit = start + PAGE_BYTES;
  if (limit >= bytes.length) return bytes.length;
  const lineBreak = bytes.lastIndexOf(0x0a, limit - 1);
  if (lineBreak >= start) return lineBreak + 1;
  let end = limit;
  while (end > start && isContinuation(bytes[end]!)) end -= 1;
  return end;
}

function startOf(cursor: string | undefined, bytes: Uint8Array): number {
  if (cursor === undefined) return 0;
  const offset = /^\d{1,15}$/.test(cursor) ? Number(cursor) : -1;
  if (offset < 0 || offset >= bytes.length || isContinuation(bytes[offset]!)) throw new RangeError(`"${cursor}" is not a cursor inside the text`);
  return offset;
}

/** One page of a part of the project; the cursor of a page is where the next starts and is absent on the last page. */
export async function readProjectContext(context: ReadContext, project: ReadyProject, request: ProjectContextRequest): Promise<ProjectContextPage> {
  const bytes = new TextEncoder().encode(await partText(context, project, request));
  const start = startOf(request.cursor, bytes);
  const end = pageEnd(bytes, start);
  const text = new TextDecoder().decode(bytes.subarray(start, end));
  return end < bytes.length ? { text, cursor: String(end) } : { text };
}
