/** Names, lists and marks the version snapshots of a project: the folder name of a version, its version.json format, the versions a folder holds and adding one. */
// CONTRACT: documents/contracts/library-format.md#project-folder-labshelf
import { parseJsonObject } from "../../json/index.js";
import { randomHex } from "../../encoding/index.js";
import { listProjectFiles, readOptionalText, type ProjectReadContext } from "./projectReads.js";

const MODULE = "writing/versions";

// --- Version file ---

/** Where a project keeps its version snapshots, relative to the project folder. */
export const VERSIONS_DIR = ".labshelf/versions";
export const VERSION_FILE = "version.json";
export const VERSION_PDF = "paper.pdf";
export const VERSION_SOURCES = "sources";

export interface VersionEntry {
  /** The snapshot's folder name under `.labshelf/versions/`. */
  slug: string;
  /** The name the user gave it. */
  name: string;
  /** ISO 8601 UTC timestamp. */
  created: string;
}

/** @returns undefined when the text is not a JSON object with a non-empty name and a valid created timestamp */
export function parseVersionFile(slug: string, text: string): VersionEntry | undefined {
  const raw = parseJsonObject(text);
  if (!raw) { return undefined; }
  const { name, created } = raw;
  if (typeof name !== "string" || name.trim() === "") { return undefined; }
  if (typeof created !== "string" || Number.isNaN(Date.parse(created))) { return undefined; }
  return { slug, name, created };
}

export function serializeVersionFile(version: Pick<VersionEntry, "name" | "created">): string {
  return `${JSON.stringify({ name: version.name, created: version.created }, null, 2)}\n`;
}

// --- Version slug ---

const MAX_SLUG_LENGTH = 60;

/** @returns a lowercase ASCII slug, or undefined when the name holds no letter or digit */
export function deriveVersionSlug(name: string): string | undefined {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  return slug === "" ? undefined : slug;
}

// --- Version model ---

/** One snapshot a project holds: its version.json fields plus where its PDF and sources are. */
export interface ProjectVersion extends VersionEntry {
  pdfPath: string;
  sourcesDir: string;
}

export interface MarkVersionRequest {
  /** The project folder. */
  folder: string;
  /** The built PDF to keep with the sources. */
  pdfPath: string;
  name: string;
  now: Date;
}

// --- Listing ---

async function readVersion({ fs, paths, logger }: ProjectReadContext, root: string, slug: string): Promise<ProjectVersion | undefined> {
  const dir = paths.join(root, slug);
  const info = await readOptionalText(fs, paths.join(dir, VERSION_FILE)).then((text) => text === undefined ? undefined : parseVersionFile(slug, text), () => undefined);
  if (!info) {
    await logger.log("WARN", MODULE, "Skipped a version with a missing or malformed version.json", { dir });
    return undefined;
  }
  return { ...info, pdfPath: paths.join(dir, VERSION_PDF), sourcesDir: paths.join(dir, VERSION_SOURCES) };
}

/** @returns the versions sorted by creation time; empty when the project has none */
export async function listVersions(context: ProjectReadContext, folder: string): Promise<ProjectVersion[]> {
  const { fs, paths } = context;
  const root = paths.join(folder, VERSIONS_DIR);
  const names: string[] = [];
  for (const name of await fs.listDir(root)) {
    if (!name.startsWith(".") && (await fs.stat(paths.join(root, name)))?.isDirectory) { names.push(name); }
  }
  const versions = (await Promise.all(names.map((slug) => readVersion(context, root, slug)))).filter((v) => v !== undefined);
  return versions.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
}

// --- Marking ---

/** Copies one file at a time, so no write is still in flight when a failure removes the temp folder. */
async function writeSnapshot({ fs, paths }: ProjectReadContext, request: MarkVersionRequest, dir: string): Promise<number> {
  const pdf = paths.resolve(request.pdfPath);
  const sources = (await listProjectFiles({ fs, paths }, request.folder))
    .filter((relative) => paths.resolve(paths.join(request.folder, ...relative.split("/"))) !== pdf);
  for (const relative of sources) {
    const segments = relative.split("/");
    await fs.writeFile(paths.join(dir, VERSION_SOURCES, ...segments), await fs.readFile(paths.join(request.folder, ...segments)));
  }
  await fs.writeFile(paths.join(dir, VERSION_PDF), await fs.readFile(pdf));
  await fs.writeText(paths.join(dir, VERSION_FILE), serializeVersionFile({ name: request.name, created: request.now.toISOString() }));
  return sources.length;
}

/**
 * Builds the snapshot in a temp folder and renames it into place, so a failure never leaves a half-written version.
 * @throws when the name has no letter or digit, the PDF is missing, or a file cannot be copied
 */
export async function addProjectVersion(context: ProjectReadContext, request: MarkVersionRequest): Promise<string> {
  const { fs, paths, logger } = context;
  const slug = deriveVersionSlug(request.name);
  if (!slug) { throw new Error(`The version name "${request.name}" has no letter or digit to name its folder.`); }
  if ((await fs.stat(request.pdfPath))?.isFile !== true) {
    throw new Error(`Cannot mark a version without the built PDF at ${request.pdfPath}`);
  }
  const versions = paths.join(request.folder, VERSIONS_DIR);
  const temp = paths.join(versions, `.${slug}.tmp-${randomHex()}`);
  const target = paths.join(versions, slug);
  try {
    const files = await writeSnapshot(context, request, temp);
    await fs.removeTree(target);
    await fs.rename(temp, target);
    await logger.log("INFO", MODULE, "Marked a version", { folder: request.folder, slug, files });
  } catch (cause) {
    await fs.removeTree(temp).catch((cleanup: unknown) => logger.error(MODULE, cleanup, { temp, action: "remove temp version" }));
    await logger.error(MODULE, cause, { folder: request.folder, temp, target });
    throw new Error(`Cannot mark version "${request.name}" of ${request.folder}`, { cause });
  }
  return target;
}
