// Scripts a LabShelf Helper behind a fake native port so client tests run without a browser.
import { chunkBytes, PROTOCOL_VERSION, type HelperBuildStatus, type TexStatus } from "@labshelf/core/helper";
import type { ILogger } from "@labshelf/core";
import type { NativePort } from "../../../src/platform";

export interface BuiltScript { status: HelperBuildStatus; pdf?: Uint8Array; pdfSha256?: string }

/** Plays the helper side of the protocol: keeps a mirror of file hashes and answers each frame in order. */
export class FakeHelper implements NativePort {
  readonly posted: Array<Record<string, unknown>> = [];
  protocol = PROTOCOL_VERSION;
  tex: TexStatus;
  built: BuiltScript = { status: "failed" };
  /** Message types the helper ignores, so a test can close the port while such a request is pending. */
  mute = new Set<string>();
  private readonly mirror = new Set<string>();
  private messageListener: (frame: unknown) => void = () => undefined;
  private disconnectListener: (reason: string | undefined) => void = () => undefined;
  private awaiting = new Map<string, string>();

  constructor(tex: TexStatus = { source: "tinytex", year: 2025, complete: true }) { this.tex = tex; }

  onMessage(listener: (frame: unknown) => void): void { this.messageListener = listener; }
  onDisconnect(listener: (reason: string | undefined) => void): void { this.disconnectListener = listener; }
  disconnect(): void { /* the test closes through close() */ }
  close(reason?: string): void { this.disconnectListener(reason); }

  post(frame: unknown): void {
    const message = frame as Record<string, any>;
    this.posted.push(message);
    if (!this.mute.has(String(message.type))) { queueMicrotask(() => this.answer(message)); }
  }

  postedOfType(type: string): Array<Record<string, any>> { return this.posted.filter((m) => m.type === type); }

  private reply(id: unknown, body: Record<string, unknown>): void { this.messageListener({ v: PROTOCOL_VERSION, id, ...body }); }

  private answer(m: Record<string, any>): void {
    if (m.type === "hello") {
      this.reply(m.id, { type: "ready", host: "helper", protocol: this.protocol, helperVersion: "1.0.0", tex: this.tex });
    } else if (m.type === "sync") {
      const need = (m.files as Array<{ path: string; sha256: string }>).filter((f) => !this.mirror.has(`${f.path}:${f.sha256}`)).map((f) => f.path);
      this.awaiting = new Map((m.files as Array<{ path: string; sha256: string }>).map((f) => [f.path, f.sha256]));
      this.reply(m.id, { type: "need", paths: need });
    } else if (m.type === "file") {
      this.answerFile(m);
    } else if (m.type === "installTex" || m.type === "installAllPackages") {
      this.tex = m.type === "installTex" ? { source: m.kind, year: 2025, complete: false } : { ...this.tex, complete: true };
      this.reply(m.id, { type: "progress", phase: "installing-tex", message: "Installing" });
      this.reply(m.id, { type: "ready", host: "helper", protocol: this.protocol, helperVersion: "1.0.0", tex: this.tex });
    } else if (m.type === "build") {
      this.answerBuild(m.id);
    }
  }

  private answerFile(m: Record<string, any>): void {
    if (m.chunk.index !== m.chunk.count - 1) { return; }
    this.mirror.add(`${m.path}:${this.awaiting.get(m.path)}`);
    this.reply(m.id, { type: "need", paths: [] });
  }

  private answerBuild(id: unknown): void {
    this.reply(id, { type: "progress", phase: "building", message: "Running pdflatex", fraction: 0.5 });
    this.reply(id, { type: "built", status: this.built.status, problems: [], ...(this.built.pdfSha256 ? { pdfSha256: this.built.pdfSha256 } : {}) });
    if (this.built.pdf) {
      for (const chunk of chunkBytes(this.built.pdf)) { this.reply(id, { type: "pdf", chunk }); }
    }
  }
}

export function fakeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined), error: jest.fn().mockResolvedValue(undefined) };
}
