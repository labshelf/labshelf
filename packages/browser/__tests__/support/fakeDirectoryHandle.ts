// An in-memory folder with the File System Access handle calls the picked-folder file system uses, case-insensitive on request.
const domError = (name: string, message: string): Error => Object.assign(new Error(message), { name });

export class FakeFile {
  readonly kind = "file";
  lastModified = 1;
  constructor(public name: string, public bytes = new Uint8Array()) {}

  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; lastModified: number; size: number }> {
    const bytes = this.bytes.slice();
    return { arrayBuffer: async () => bytes.buffer, lastModified: this.lastModified, size: bytes.length };
  }

  async createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> {
    let pending = new Uint8Array();
    return {
      write: async (data) => { pending = data.slice(); },
      close: async () => { this.bytes = pending; this.lastModified += 1; },
      abort: async () => undefined,
    };
  }
}

export class FakeDir {
  readonly kind = "directory";
  readonly children = new Map<string, FakeDir | FakeFile>();
  constructor(public name: string, private readonly caseInsensitive = false) {}

  private key(name: string): string {
    return this.caseInsensitive ? name.toLowerCase() : name;
  }

  private child<T extends FakeDir | FakeFile>(name: string, kind: T["kind"], create: boolean, make: () => T): T {
    const found = this.children.get(this.key(name));
    if (found && found.kind !== kind) throw domError("TypeMismatchError", `${name} is not a ${kind}`);
    if (found) return found as T;
    if (!create) throw domError("NotFoundError", `${name} not found`);
    const made = make();
    this.children.set(this.key(name), made);
    return made;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDir> {
    return this.child(name, "directory", options?.create ?? false, () => new FakeDir(name, this.caseInsensitive));
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFile> {
    return this.child(name, "file", options?.create ?? false, () => new FakeFile(name));
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const found = this.children.get(this.key(name));
    if (!found) throw domError("NotFoundError", `${name} not found`);
    if (found.kind === "directory" && found.children.size && !options?.recursive) throw domError("InvalidModificationError", `${name} is not empty`);
    this.children.delete(this.key(name));
  }

  async *keys(): AsyncGenerator<string> {
    for (const entry of this.children.values()) yield entry.name;
  }

  async *entries(): AsyncGenerator<[string, FakeDir | FakeFile]> {
    for (const entry of this.children.values()) yield [entry.name, entry];
  }

  /** Every file below this folder as "path: text", sorted. */
  dump(prefix = ""): string[] {
    return [...this.children.values()].flatMap((entry) => entry.kind === "file"
      ? [`${prefix}${entry.name}: ${new TextDecoder().decode(entry.bytes)}`]
      : entry.dump(`${prefix}${entry.name}/`)).sort();
  }
}
