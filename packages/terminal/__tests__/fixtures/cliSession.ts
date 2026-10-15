// Shared harness for the CLI command tests: opens a temp library with isolated XDG dirs and runs
// commands through fresh in-memory stdout/stderr buffers.
import { promises as fs } from "node:fs";

import { openLibrary, type AppContext } from "../../src/app/context";
import type { TerminalConfig } from "../../src/app/config";
import { parseArgs } from "../../src/cli/args";
import { runLibraryCommand, type Output } from "../../src/cli";
import { createTempLibrary, makeTempDir, cleanupTempDirs, type PaperFixture, type TempLibrary } from "./library";

const ENV_KEYS = ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LABSHELF_TOKEN_STORE", "LABSHELF_IMAGES", "LABSHELF_GOOGLE_CLIENT_ID", "LABSHELF_GOOGLE_CLIENT_SECRET", "LABSHELF_PDF_VIEWER"];

export const NOW = "2025-01-01T00:00:00.000Z";

export function highlight(id: string, page: number, content: string): Record<string, unknown> {
  return {
    id, paperId: "vaswani2017attention", type: "highlight", pageNumber: page, content, color: "yellow",
    position: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, createdAt: NOW, updatedAt: NOW,
  };
}

export const PAPERS: PaperFixture[] = [
  {
    id: "vaswani2017attention",
    collection: "ML",
    title: "Attention Is All You Need",
    pdf: "%PDF-1.4 attention",
    meta: {
      authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, status: "unread", tags: ["nlp"], doi: "10.5555/3295222.3295349",
      journal: "NeurIPS", summary: "The Transformer.", note: "Read section 3", vscodeOnly: { keep: true },
    },
    sidecar: {
      annotations: [highlight("h2", 2, "positional encodings"), highlight("h1", 1, "self-attention replaces recurrence")],
      theme: "dark",
      reading: { page: 7, scaleValue: "1.25", updatedAt: NOW },
    },
  },
  { id: "devlin2019bert", collection: "ML/Language", title: "BERT: Pre-training", pdf: true, meta: { authors: ["Jacob Devlin"], year: 2019, status: "reading", tags: ["nlp", "pretraining"] } },
  { id: "he2016resnet", collection: "ML/Vision", title: "Deep Residual Learning", meta: { authors: ["Kaiming He"], year: 2016, status: "done", doi: "10.1109/CVPR.2016.90" } },
  { id: "notes2020", title: "Loose notes", meta: { year: 2020 } },
];

export interface Session {
  lib: TempLibrary;
  ctx: AppContext;
  out: string[];
  err: string[];
  /** Runs one command line and returns its exit code. */
  run(...argv: string[]): Promise<number>;
  text(): string;
  errText(): string;
}

export interface SessionOptions {
  config?: TerminalConfig;
  env?: Record<string, string>;
  columns?: number;
  collections?: string[];
  prepare?: (lib: TempLibrary) => Promise<void>;
}

/** Isolates XDG dirs and process.env for one CLI test and opens disposable library sessions. */
export class CliSessionHarness {
  private saved: Record<string, string | undefined> = {};
  private opened: AppContext[] = [];
  xdgConfig = "";
  xdgCache = "";

  async setup(): Promise<void> {
    for (const key of ENV_KEYS) { this.saved[key] = process.env[key]; }
    this.xdgConfig = await makeTempDir("labshelf-xdgc-");
    this.xdgCache = await makeTempDir("labshelf-xdgx-");
    // The file token store resolves its folder from process.env, so keep the real ~/.config out of every test.
    process.env["XDG_CONFIG_HOME"] = this.xdgConfig;
    process.env["XDG_CACHE_HOME"] = this.xdgCache;
    process.env["LABSHELF_TOKEN_STORE"] = "file";
    process.env["LABSHELF_IMAGES"] = "off";
    delete process.env["LABSHELF_PDF_VIEWER"];
    process.env["LABSHELF_GOOGLE_CLIENT_ID"] = "test-client-id-0123456789";
  }

  async teardown(): Promise<void> {
    await Promise.all(this.opened.splice(0).map((ctx) => ctx.dispose()));
    for (const key of ENV_KEYS) {
      if (this.saved[key] === undefined) { delete process.env[key]; } else { process.env[key] = this.saved[key]; }
    }
    await cleanupTempDirs();
  }

  async session(papers: PaperFixture[] = PAPERS, options: SessionOptions = {}): Promise<Session> {
    const lib = await createTempLibrary(papers);
    for (const rel of options.collections ?? []) { await lib.addCollection(rel); }
    await options.prepare?.(lib);
    const env: NodeJS.ProcessEnv = {
      XDG_CONFIG_HOME: this.xdgConfig,
      XDG_CACHE_HOME: this.xdgCache,
      LABSHELF_TOKEN_STORE: "file",
      LABSHELF_IMAGES: "off",
      LABSHELF_GOOGLE_CLIENT_ID: "test-client-id-0123456789",
      ...(process.env["PATH"] ? { PATH: process.env["PATH"] } : {}),
      ...(options.env ?? {}),
    };
    const ctx = await openLibrary(lib.root, { config: options.config ?? { version: 1 }, env, watch: false, thumbnailWorkerUrl: new URL("file:///unused/thumbnailWorker.mjs") });
    this.opened.push(ctx);
    const out: string[] = [];
    const err: string[] = [];
    const io: Output = { out: (t) => out.push(t), err: (t) => err.push(t), columns: options.columns ?? 100 };
    return {
      lib, ctx, out, err,
      run: (...argv) => runLibraryCommand(ctx, parseArgs(argv), io),
      text: () => out.join("\n"),
      errText: () => err.join("\n"),
    };
  }

  async signIn(): Promise<void> {
    const dir = `${this.xdgConfig}/labshelf`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${dir}/credentials.json`, JSON.stringify({ access_token: "a", refresh_token: "r", expiry_ms: Date.now() + 3_600_000 }), { mode: 0o600 });
  }
}
