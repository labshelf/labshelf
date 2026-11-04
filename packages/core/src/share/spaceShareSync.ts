/**
 * What runs beside a connected Space share: its projects follow the index's `projects` map both ways, the papers this library
 * holds publish their info and serve their PDFs, and the papers it lacks download into a library folder.
 */
// CONTRACT: documents/contracts/collaboration.md#space-projects
// CONTRACT: documents/contracts/collaboration.md#space-papers
import type { Map as YMap } from "yjs";
import type { ShareConnection } from "../collab/session/index.js";
import { formatInvite } from "../collab/index.js";
import { deriveSha256Hex } from "../hash/index.js";
import { isRecord } from "../guards/index.js";
import { createPaper, type MutationContext } from "../library/index.js";
import type { PaperRecord } from "../model/index.js";
import { baseName } from "../path/index.js";
import { readPaperInfo, type LibraryPapers, type Space, type SpacePaperInfo, type SpaceStore } from "../spaces/index.js";
import { checkInvite, joinInvite, startProjectShare } from "./projectShareFlows.js";
import { freeFolder } from "./shareImport.js";
import { isSharedProject, LOG_MODULE, readCurrentInvite, type ShareFlowPorts } from "./sharedProjects.js";

/** What the app gives a Space share: the share workflows, the Space store and the library the papers live in. */
export interface SpaceShareDeps {
  ports: ShareFlowPorts;
  spaces: SpaceStore;
  papers(): LibraryPapers;
  onPapersChange(listener: () => void): () => void;
  onProjectsChange(listener: () => void): () => void;
  /** The bytes of the paper's PDF; undefined when it has none on this device. */
  readPdf(paperId: string): Promise<Uint8Array | undefined>;
}

interface SpaceProjectEntry { invite: string; title: string }

const projectsMap = (connection: ShareConnection): YMap<unknown> => connection.session.index.getMap("projects");

function readProjectEntry(value: unknown): SpaceProjectEntry | undefined {
  return isRecord(value) && typeof value["invite"] === "string" && typeof value["title"] === "string"
    ? { invite: value["invite"], title: value["title"] } : undefined;
}

async function readSpace(deps: SpaceShareDeps, id: string): Promise<Space | undefined> {
  const read = await deps.spaces.read(id);
  return read.state === "ready" && read.readOnlyReason === undefined ? read.space : undefined;
}

/** The project share ids this run saw both in the map and linked here, so a later absence on one side is a removal. */
type Agreed = Set<string>;

async function inviteOf(ports: ShareFlowPorts, shareId: string): Promise<string | undefined> {
  const connection = ports.shares.active(shareId);
  if (connection) { return readCurrentInvite(ports, connection); }
  const stored = await ports.keys.invite(shareId);
  return stored && formatInvite(stored);
}

/** Links here what the map holds and puts into the map what is linked here, sharing and joining projects as needed. */
async function syncProjects(deps: SpaceShareDeps, connection: ShareConnection, spaceId: string, agreed: Agreed, signal: AbortSignal): Promise<void> {
  const { ports, spaces } = deps;
  const space = await readSpace(deps, spaceId);
  if (!space) { return; }
  const map = projectsMap(connection);
  const ready = () => ports.projects.list().filter((entry) => entry.kind === "ready" && !entry.settings.trashed);
  const linked = new Set(space.projects);
  for (const id of space.projects) {
    const entry = ready().find((candidate) => candidate.kind === "ready" && candidate.settings.id === id);
    if (!entry || entry.kind !== "ready") { continue; }
    let shareId = entry.settings.shared;
    if (shareId === undefined) {
      const outcome = await startProjectShare(ports, { folder: entry.folder, shared: undefined, signal });
      if (outcome.kind !== "shared") { continue; }
      shareId = outcome.connection.shareId;
    }
    if (map.has(shareId)) { agreed.add(shareId); continue; }
    if (agreed.has(shareId)) {
      // Another member took the project out of the Space.
      agreed.delete(shareId);
      await spaces.unlinkProject(spaceId, id);
      continue;
    }
    const invite = await inviteOf(ports, shareId);
    if (invite) { map.set(shareId, { invite, title: entry.settings.title ?? entry.settings.id }); agreed.add(shareId); }
  }
  for (const [shareId, value] of [...map.entries()]) {
    const project = ports.projects.list().filter(isSharedProject).find((entry) => entry.settings.shared === shareId);
    if (project && linked.has(project.settings.id)) { continue; }
    if (project && agreed.has(shareId)) {
      // This member took the project out of the Space.
      agreed.delete(shareId);
      map.delete(shareId);
      continue;
    }
    const id = project?.settings.id ?? await joinProject(ports, shareId, readProjectEntry(value), signal);
    if (id === undefined) { continue; }
    await spaces.linkProject(spaceId, id);
    agreed.add(shareId);
  }
}

async function joinProject(ports: ShareFlowPorts, shareId: string, entry: SpaceProjectEntry | undefined, signal: AbortSignal): Promise<string | undefined> {
  if (!entry) { return undefined; }
  const checked = await checkInvite(entry.invite);
  if (!checked.ok || checked.invite.shareId !== shareId) {
    void ports.logger.log("WARN", LOG_MODULE, "Skipped a Space project whose invite is not valid", { shareId });
    return undefined;
  }
  const outcome = await joinInvite(ports, checked.invite, signal);
  if (outcome.kind === "refused" || outcome.place !== "project") { return undefined; }
  const joined = ports.projects.list().find((candidate) => candidate.folder === outcome.folder);
  return joined?.kind === "ready" ? joined.settings.id : undefined;
}

interface HeldPdf { sha256: string; bytes: number }

function deriveInfo(record: PaperRecord, pdf: HeldPdf | undefined): SpacePaperInfo {
  return {
    title: record.title,
    ...(record.authors && record.authors.length > 0 ? { authors: record.authors } : {}),
    ...(record.year === undefined ? {} : { year: record.year }),
    ...(record.doi ? { doi: record.doi } : {}),
    ...(record.url ? { url: record.url } : {}),
    ...(pdf ? { pdf } : {}),
  };
}

/** Writes `info` for every paper of the Space this library holds, and remembers which PDF each hash names. */
async function publishPapers(deps: SpaceShareDeps, spaceId: string, held: Map<string, HeldPdf | null>, served: Map<string, string>): Promise<void> {
  const space = await readSpace(deps, spaceId);
  if (!space) { return; }
  const library = deps.papers();
  for (const ref of space.papers) {
    const record = library.get(ref.id)?.record;
    if (!record || record.trashedAt) { continue; }
    if (!held.has(ref.id)) {
      const bytes = await deps.readPdf(ref.id);
      held.set(ref.id, bytes ? { sha256: await deriveSha256Hex(bytes), bytes: bytes.length } : null);
    }
    const pdf = held.get(ref.id) ?? undefined;
    if (pdf) { served.set(pdf.sha256, ref.id); }
    const info = deriveInfo(record, pdf);
    if (JSON.stringify(readPaperInfo(ref)) !== JSON.stringify(info)) { await deps.spaces.setPaperInfo(spaceId, ref.id, info); }
  }
}

/** Starts the work beside a connected Space share; returns the stop, which waits for nothing. */
export function attachSpaceShare(connection: ShareConnection, deps: SpaceShareDeps): () => void {
  const spaceId = baseName(connection.folder.replace(/\\/g, "/"));
  const stopped = new AbortController();
  const agreed: Agreed = new Set();
  const held = new Map<string, HeldPdf | null>();
  const served = new Map<string, string>();
  let running = Promise.resolve();
  let queued = false;
  const run = (): void => {
    if (queued || stopped.signal.aborted) { return; }
    queued = true;
    running = running.then(async () => {
      queued = false;
      if (stopped.signal.aborted) { return; }
      await syncProjects(deps, connection, spaceId, agreed, stopped.signal)
        .catch((error: unknown) => deps.ports.logger.error(LOG_MODULE, error, { action: "sync the projects of a shared Space", spaceId }));
      await publishPapers(deps, spaceId, held, served)
        .catch((error: unknown) => deps.ports.logger.error(LOG_MODULE, error, { action: "publish the papers of a shared Space", spaceId }));
    });
  };
  const onPapers = (): void => { held.clear(); run(); };
  const map = projectsMap(connection);
  map.observe(run);
  const stops = [
    deps.spaces.onChange(run), deps.onProjectsChange(run), deps.onPapersChange(onPapers),
    connection.serveBlobs(async (hash) => {
      const paperId = served.get(hash);
      const bytes = paperId === undefined ? undefined : await deps.readPdf(paperId);
      return bytes && (await deriveSha256Hex(bytes)) === hash ? bytes : undefined;
    }),
    () => map.unobserve(run),
  ];
  run();
  return () => { stopped.abort(); stops.forEach((stop) => stop()); };
}

export interface DownloadSpacePapersRequest {
  spaceId: string;
  /** One paper, a Space folder with its subfolders, or the whole Space. */
  what: { kind: "paper"; paperId: string } | { kind: "folder"; folderId: string } | { kind: "space" };
  /** The library folder (absolute) the papers, or the folder of the same name, go into. */
  destination: string;
  ctx: MutationContext;
}

export interface DownloadSpacePapersOutcome {
  added: PaperRecord[];
  /** Papers whose id the library already uses; nothing was imported for them. */
  present: string[];
  /** Titles of papers imported without their PDF, since no peer could send it. */
  missingPdfs: string[];
}

/** A Space folder becomes a library folder of the same name, its subfolders inside it; a single paper goes in as it is. */
export async function downloadSpacePapers(connection: ShareConnection, deps: SpaceShareDeps, request: DownloadSpacePapersRequest): Promise<DownloadSpacePapersOutcome> {
  const space = await readSpace(deps, request.spaceId);
  if (!space) { throw new Error("This Space cannot be read, so its papers cannot be downloaded."); }
  const outcome: DownloadSpacePapersOutcome = { added: [], present: [], missingPdfs: [] };
  const library = deps.papers();
  const taken = [...library.keys()];
  const { what, ctx } = request;
  const download = async (paperId: string, dir: string): Promise<void> => {
    const ref = space.papers.find((paper) => paper.id === paperId);
    if (!ref) { return; }
    if (library.has(paperId) || taken.includes(paperId)) { outcome.present.push(paperId); return; }
    const info = readPaperInfo(ref);
    let pdf: Uint8Array | undefined;
    if (info?.pdf) {
      pdf = await fetchPdf(connection, info.pdf.sha256, deps, paperId);
      if (!pdf) { outcome.missingPdfs.push(info.title); }
    }
    const record = await createPaper(ctx, taken, dir, {
      citeKey: paperId,
      fields: { title: info?.title ?? paperId, ...(info?.authors ? { authors: [...info.authors] } : {}), ...(info?.year === undefined ? {} : { year: info.year }),
        ...(info?.doi ? { doi: info.doi } : {}), ...(info?.url ? { url: info.url } : {}) },
      pdf,
      sourceName: `Space "${space.name}"`,
    });
    taken.push(record.id);
    outcome.added.push(record);
  };
  const downloadFolder = async (folderId: string | undefined, dir: string): Promise<void> => {
    for (const ref of space.papers.filter((paper) => paper.folder === folderId)) { await download(ref.id, dir); }
    for (const folder of space.folders.filter((candidate) => candidate.parent === folderId)) {
      await downloadFolder(folder.id, await freeFolder(ctx, dir, folder.name));
    }
  };
  if (what.kind === "paper") { await download(what.paperId, request.destination); }
  if (what.kind === "folder") {
    const folder = space.folders.find((candidate) => candidate.id === what.folderId);
    if (!folder) { throw new Error("This folder is no longer in the Space."); }
    await downloadFolder(folder.id, await freeFolder(ctx, request.destination, folder.name));
  }
  if (what.kind === "space") { await downloadFolder(undefined, await freeFolder(ctx, request.destination, space.name)); }
  await ctx.logger.log("INFO", LOG_MODULE, "Downloaded papers of a shared Space", {
    spaceId: request.spaceId, added: outcome.added.length, present: outcome.present.length, missingPdfs: outcome.missingPdfs.length,
  });
  return outcome;
}

async function fetchPdf(connection: ShareConnection, sha256: string, deps: SpaceShareDeps, paperId: string): Promise<Uint8Array | undefined> {
  try {
    return await connection.blobs.fetch(sha256);
  } catch (error) {
    void deps.ports.logger.log("WARN", LOG_MODULE, "No member sent the PDF of a Space paper", { paperId, error: String(error) });
    return undefined;
  }
}
