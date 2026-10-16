// Persists and queries the per-provider sync manifest, the three-way merge base.
// It maps relative paths to their last-synced state.
import type { LocalFileSystem } from "../../../ports/index.js";
import type {
  ManifestData,
  ManifestEntry,
} from "../syncTypes.js";
import type { RemoteNamespace } from "../../provider/index.js";

function emptyData(providerId: string): ManifestData {
  return { providerId, namespaces: { library: {}, appdata: {}, projects: {} } };
}

/**
 * Reads and writes the manifest JSON via an injected LocalFileSystem.
 * The manifest is local-only state (never synced).
 */
export class SyncManifest {
  private data: ManifestData;

  private constructor(
    private readonly fs: LocalFileSystem,
    private readonly filePath: string,
    data: ManifestData,
  ) {
    this.data = data;
  }

  /**
   * Loads the manifest from disk, or starts empty when absent or corrupt.
   */
  static async load(
    fs: LocalFileSystem,
    filePath: string,
    providerId: string,
  ): Promise<SyncManifest> {
    let data = emptyData(providerId);
    const stat = await fs.stat(filePath);
    if (stat?.isFile) {
      try {
        const raw = await fs.readFile(filePath);
        const text = new TextDecoder("utf-8").decode(raw);
        const parsed = JSON.parse(text) as ManifestData;
        if (parsed?.namespaces?.library && parsed.namespaces.appdata) {
          data = { providerId, namespaces: { ...parsed.namespaces, projects: parsed.namespaces.projects ?? {} } };
          if (parsed.roots && typeof parsed.roots === "object") { data.roots = { ...parsed.roots }; }
        }
      } catch {
        // Corrupt manifest: fall back to empty, sync rebuilds it.
      }
    }
    return new SyncManifest(fs, filePath, data);
  }

  get(ns: RemoteNamespace, path: string): ManifestEntry | undefined {
    return this.data.namespaces[ns][path];
  }

  paths(ns: RemoteNamespace): string[] {
    return Object.keys(this.data.namespaces[ns]);
  }

  set(ns: RemoteNamespace, path: string, entry: ManifestEntry): void {
    this.data.namespaces[ns][path] = entry;
  }

  delete(ns: RemoteNamespace, path: string): void {
    delete this.data.namespaces[ns][path];
  }

  /**
   * The remote root folder id the namespace was last synced against, when recorded.
   * @returns the id, or undefined when no root was recorded
   */
  rootId(ns: RemoteNamespace): string | undefined {
    return this.data.roots?.[ns];
  }

  setRootId(ns: RemoteNamespace, id: string): void {
    this.data.roots = { ...(this.data.roots ?? {}), [ns]: id };
  }

  /**
   * Forgets every entry of a namespace, so the next diff treats both sides as first-seen (nothing is deleted).
   */
  clearNamespace(ns: RemoteNamespace): void {
    this.data.namespaces[ns] = {};
  }

  async save(): Promise<void> {
    const json = JSON.stringify(this.data, null, 2);
    await this.fs.writeFile(this.filePath, new TextEncoder().encode(json));
  }

  /** A deep copy of the data, so callers cannot mutate the manifest. */
  snapshot(): ManifestData {
    return JSON.parse(JSON.stringify(this.data)) as ManifestData;
  }
}
