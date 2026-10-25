// Holds the demo library in memory, built from the build-time snapshot with core's own metadata and folder readers.
import {
  deriveFoldersFromFilePaths, deriveEditedTags, createPaperRecord, derivePaperStats, parsePaperMetadata, derivePdfDirs,
  type LibraryUiSnapshot, type PaperRecord, type ReadingStatus, type SidecarView,
} from "@labshelf/core";

/** One file of the demo library; `path` starts at "papers". */
export interface DemoFile {
  path: string;
  size: number;
  modified: string;
}

/** What `website/build/demoData.mjs` writes: every file under papers/, metadata.yaml text by paper folder, sidecars by id. */
export interface DemoData {
  files: DemoFile[];
  metadata: Record<string, string>;
  sidecars: Record<string, SidecarView>;
}

export interface DemoLibrary {
  readonly files: readonly DemoFile[];
  paper(id: string): PaperRecord | undefined;
  sidecar(id: string): SidecarView;
  snapshot(): LibraryUiSnapshot;
  setStatus(ids: readonly string[], status: ReadingStatus): void;
  setTags(ids: readonly string[], add: readonly string[], remove: readonly string[]): void;
  setNote(id: string, note: string): void;
}

function readRecords(data: DemoData, pdfDirs: ReadonlySet<string>): Map<string, PaperRecord> {
  const records = new Map<string, PaperRecord>();
  for (const [dir, text] of Object.entries(data.metadata)) {
    const meta = parsePaperMetadata(text);
    if (!meta) throw new Error(`Demo library: ${dir}/metadata.yaml is not a YAML mapping`);
    const id = dir.slice(dir.lastIndexOf("/") + 1);
    records.set(id, createPaperRecord(meta, { id, path: dir, hasPdf: pdfDirs.has(dir) }));
  }
  return records;
}

export function createDemoLibrary(data: DemoData, now: () => string = () => new Date().toISOString()): DemoLibrary {
  const paths = data.files.map((f) => f.path);
  const pdfDirs = derivePdfDirs(paths);
  const folders = deriveFoldersFromFilePaths(paths);
  const records = readRecords(data, pdfDirs);
  const update = (ids: readonly string[], patch: (r: PaperRecord) => Partial<PaperRecord>): void => {
    for (const id of ids) {
      const record = records.get(id);
      if (record) records.set(id, { ...record, ...patch(record) });
    }
  };
  const sidecar = (id: string): SidecarView => data.sidecars[id] ?? { annotations: [] };
  return {
    files: data.files,
    paper: (id) => records.get(id),
    sidecar,
    snapshot: () => {
      const papers = [...records.values()];
      const stats = Object.fromEntries(papers.filter((p) => data.sidecars[p.id]).map((p) => [p.id, derivePaperStats(sidecar(p.id))]));
      return { folders, papers, pdfDirs: [...pdfDirs], stats };
    },
    setStatus: (ids, status) => update(ids, (r) => (r.status === status ? {} : { status, statusChangedAt: now() })),
    setTags: (ids, add, remove) => update(ids, (r) => ({ tags: deriveEditedTags(r.tags ?? [], add, remove) })),
    setNote: (id, note) => update([id], () => ({ note })),
  };
}
