// Plays the bridge host behind a fake native port over an in-memory library, so bridge and storage tests run without a host.
import { base64ToBytes, BRIDGE_CHUNK_BYTES, BRIDGE_PROTOCOL, bytesToBase64, type ILogger } from "../../src/index";
import type { NativeMessagePort } from "../../src/index";

type Message = Record<string, any>;

export const silentLogger: ILogger = { log: async () => undefined, error: async () => undefined };

export class FakeBridgeHost implements NativeMessagePort {
  readonly posted: Message[] = [];
  files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  protocol = BRIDGE_PROTOCOL;
  libraryRoot: string | undefined = "/home/me/Library";
  /** Ops the host never answers, so a test can close the port while one is pending. */
  mute = new Set<string>();
  /** When set, the port closes with this reason as soon as anything is posted, like a missing host. */
  missingReason: string | undefined;
  /** Results the host answers for an op instead of the real one, to play a malformed host. */
  readonly replies = new Map<string, unknown>();
  disconnected = false;
  private messageListener: (frame: unknown) => void = () => undefined;
  private disconnectListener: (reason: string | undefined) => void = () => undefined;
  private readonly staged = new Map<number, { path: string; parts: Uint8Array[] }>();

  onMessage(listener: (frame: unknown) => void): void { this.messageListener = listener; }
  onDisconnect(listener: (reason: string | undefined) => void): void { this.disconnectListener = listener; }
  disconnect(): void { this.disconnected = true; }
  close(reason?: string): void { this.disconnectListener(reason); }
  emitChanged(paths: string[]): void { this.messageListener({ event: "changed", paths }); }
  ofOp(op: string): Message[] { return this.posted.filter((m) => m.op === op); }

  post(frame: unknown): void {
    const message = frame as Message;
    this.posted.push(message);
    if (this.missingReason !== undefined) { queueMicrotask(() => this.close(this.missingReason)); return; }
    if (!this.mute.has(message.op)) queueMicrotask(() => this.answer(message));
  }

  private ok(id: number, result: unknown): void { this.messageListener({ id, ok: true, result }); }
  private fail(id: number, code: string, message: string): void { this.messageListener({ id, ok: false, error: { code, message } }); }

  private answer(m: Message): void {
    if (m.op === "hello") return this.hello(m);
    if (m.op === "setLibrary") return this.setLibrary(m);
    if (this.libraryRoot === undefined) return this.fail(m.id, "noLibrary", "no library");
    if (this.replies.has(m.op)) return this.ok(m.id, this.replies.get(m.op));
    switch (m.op) {
      case "stat": return this.ok(m.id, { stat: this.stat(m.path) });
      case "readFile": return this.read(m);
      case "writeFile": this.staged.set(m.id, { path: m.path, parts: [] }); return;
      case "chunk": this.staged.get(m.id)?.parts.push(base64ToBytes(m.data)); return;
      case "commit": return this.commit(m);
      case "deleteFile": this.files.delete(m.path); return this.ok(m.id, {});
      case "deleteDir": return this.deleteDir(m);
      case "ensureDir": this.dirs.add(m.path); return this.ok(m.id, {});
      case "listDir": return this.ok(m.id, { names: this.list(m.path) });
      case "rename": return this.rename(m);
      default: return this.fail(m.id, "protocol", `unknown op ${String(m.op)}`);
    }
  }

  private setLibrary(m: Message): void {
    if (this.libraryRoot !== undefined) return this.fail(m.id, "protocol", "A library is already set");
    if (m.root.includes("missing")) return this.fail(m.id, "noLibrary", `The library folder ${m.root} does not exist`);
    this.libraryRoot = m.root;
    this.ok(m.id, { libraryRoot: m.root, paperCount: 0 });
  }

  private hello(m: Message): void {
    if (m.protocol !== this.protocol) return this.fail(m.id, "protocol", "other protocol version");
    if (this.libraryRoot === undefined) return this.fail(m.id, "noLibrary", "no library configured");
    this.ok(m.id, { protocol: this.protocol, libraryRoot: this.libraryRoot, paperCount: 0 });
  }

  private stat(path: string): unknown {
    const file = this.files.get(path);
    if (file) return { isFile: true, isDirectory: false, mtimeMs: 1, size: file.length };
    return this.dirs.has(path) ? { isFile: false, isDirectory: true, mtimeMs: 1, size: 0 } : null;
  }

  private list(dir: string): string[] {
    const prefix = dir ? `${dir}/` : "";
    const names = [...this.files.keys(), ...this.dirs].filter((key) => key.startsWith(prefix));
    return [...new Set(names.map((key) => key.slice(prefix.length).split("/")[0]!))];
  }

  private read(m: Message): void {
    const bytes = this.files.get(m.path);
    if (!bytes) return this.fail(m.id, "notFound", `${m.path} does not exist`);
    for (let offset = 0; offset < bytes.length; offset += BRIDGE_CHUNK_BYTES) {
      this.messageListener({ id: m.id, chunk: bytesToBase64(bytes.subarray(offset, offset + BRIDGE_CHUNK_BYTES)) });
    }
    this.ok(m.id, { done: true, size: bytes.length });
  }

  private commit(m: Message): void {
    const write = this.staged.get(m.id);
    if (!write) return this.fail(m.id, "protocol", "no open write");
    this.staged.delete(m.id);
    const bytes = new Uint8Array(write.parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of write.parts) { bytes.set(part, offset); offset += part.length; }
    if (bytes.length !== m.size) return this.fail(m.id, "protocol", "size mismatch");
    this.files.set(write.path, bytes);
    this.ok(m.id, { size: bytes.length });
  }

  private deleteDir(m: Message): void {
    for (const key of [...this.files.keys()]) if (key.startsWith(`${m.path}/`)) this.files.delete(key);
    this.dirs.delete(m.path);
    this.ok(m.id, {});
  }

  private rename(m: Message): void {
    const bytes = this.files.get(m.from);
    if (!bytes) return this.fail(m.id, "notFound", `${m.from} does not exist`);
    this.files.delete(m.from);
    this.files.set(m.to, bytes);
    this.ok(m.id, {});
  }
}
