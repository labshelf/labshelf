// Renders one app frame to text without a real terminal, for the `--dump-frame` debug flag.
import type { AppContext } from "../app/index.js";
import { App, type TerminalLike } from "../ui/app/index.js";
import { InputDecoder } from "../tui/index.js";
import type { Screen } from "../tui/index.js";

// A terminal that renders into memory, for --dump-frame.
class MemoryTerminal implements TerminalLike {
  frame: Screen | undefined;
  constructor(private readonly cols: number, private readonly rows: number) {}
  size() { return { cols: this.cols, rows: this.rows }; }
  listen(): void { /* input comes from --keys */ }
  enter(): void { /* nothing to take over */ }
  leave(): void { /* nothing to restore */ }
  draw(frame: Screen): void { this.frame = frame; }
  invalidate(): void { /* no previous frame kept */ }
  writeRaw(): void { /* no images in text output */ }
  suspend<T>(run: () => T): T { return run(); }
  stopJob(): void { /* not a job */ }
}

// "jj<enter><C-d>" → key events, through the real decoder.
function keysToInput(spec: string): string {
  const names: Record<string, string> = {
    enter: "\r", esc: "\x1b", tab: "\t", space: " ", bs: "\x7f", up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D",
  };
  return spec.replace(/<([^>]+)>/g, (_, name: string) => {
    if (/^C-[a-z]$/.test(name)) { return String.fromCharCode(name.charCodeAt(2) - 96); }
    return names[name] ?? `<${name}>`;
  });
}

export async function dumpFrame(ctx: AppContext, size: string, keys: string | undefined, writeOut: (text: string) => void): Promise<void> {
  const [cols, rows] = size.split("x").map(Number);
  const term = new MemoryTerminal(cols || 120, rows || 36);
  const app = new App({ ...ctx, imageProtocol: "none" }, term);
  const decoder = new InputDecoder();
  // Let the async sidecar loads settle before the snapshot is taken.
  for (const event of [...decoder.feed(keysToInput(keys ?? "")), ...decoder.flush()]) {
    app.handle(event);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  // A frame starts the async loads (sidecars, thumbnails) the final frame shows.
  app.frame();
  await new Promise((resolve) => setTimeout(resolve, 80));
  writeOut(app.frame().screen.toText());
}
