/** @jest-environment jsdom */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ILogger } from "../../../../src/ports/index.js";
import type { DictionaryFiles, DictionaryStore } from "../../../../src/writing/proofing/port.js";
import { createProofing, proofingStateOf } from "../../../../src/writing/dom/sourceEditor/proofing.js";

function readDictionary(pkg: string): DictionaryFiles | undefined {
  const candidates = [join(process.cwd(), "node_modules", pkg), join(process.cwd(), "packages", "core", "node_modules", pkg)];
  const folder = candidates.find((candidate) => existsSync(join(candidate, "index.aff")));
  if (!folder) return undefined;
  return { aff: new Uint8Array(readFileSync(join(folder, "index.aff"))), dic: new Uint8Array(readFileSync(join(folder, "index.dic"))) };
}

const en = readDictionary("dictionary-en");
const describeWithDictionaries = en ? describe : describe.skip;

interface Deferred { resolve(): void; reject(error: Error): void }

/** A store with English only; install() waits for the test, then serves the English files under the new tag. */
function fakeStore(): DictionaryStore & { installs: string[]; pending: Deferred[] } {
  const installed = new Set(["en-US"]);
  const installs: string[] = [];
  const pending: Deferred[] = [];
  return {
    installs, pending,
    list: async () => [...installed],
    read: async (tag) => (installed.has(tag) ? en! : null),
    install: (tag) => {
      installs.push(tag);
      return new Promise<void>((resolve, reject) => {
        pending.push({ resolve: () => { installed.add(tag); resolve(); }, reject });
      });
    },
    userWords: async () => [],
    addUserWord: async () => undefined,
  };
}

const views: EditorView[] = [];

function makeView(doc: string, store: DictionaryStore): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: [createProofing({ store, enabled: true, disable: () => undefined }, "latex")] }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, timeout = 15_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

const panel = (view: EditorView): HTMLElement | null => view.dom.querySelector<HTMLElement>(".ls-proofing-notice");
const noticeText = (view: EditorView): string | null | undefined => panel(view)?.querySelector("[role=status]")?.textContent;
const buttons = (view: EditorView): HTMLButtonElement[] => [...(panel(view)?.querySelectorAll("button") ?? [])];
const labels = (view: EditorView): string[] => buttons(view).map((button) => button.textContent ?? "");
const press = (view: EditorView, label: string): void => buttons(view).find((button) => button.textContent === label)!.click();

const french = (body: string): string => `\\documentclass{article}\n\\usepackage[french]{babel}\n\\begin{document}\n${body}\n\\end{document}\n`;

describeWithDictionaries("proofing notice", () => {
  it("installs a missing dictionary through the store, shows the busy state, then hides and checks", async () => {
    const store = fakeStore();
    const view = makeView(french("This is teh text."), store);
    await until(() => proofingStateOf(view.state)?.status === "missing", "the missing status");
    expect(noticeText(view)).toBe("No French dictionary installed.");
    expect(labels(view)).toEqual(["Install", "Not now"]);
    expect(buttons(view)[0]!.className).toContain("ls-btn-primary");
    expect(view.dom.querySelector(".cm-panels-top .ls-proofing-notice")).not.toBeNull();

    press(view, "Install");
    expect(store.installs).toEqual(["fr"]);
    expect(noticeText(view)).toBe("Installing the French dictionary…");
    expect(buttons(view).every((button) => button.disabled)).toBe(true);

    store.pending[0]!.resolve();
    await until(() => panel(view) === null, "the panel to hide");
    await until(() => proofingStateOf(view.state)?.status === "ready", "the checker");
    const spelling: string[] = [];
    await until(() => {
      forceLinting(view);
      spelling.length = 0;
      forEachDiagnostic(view.state, (d, from, to) => { if (d.source === "spelling") spelling.push(view.state.sliceDoc(from, to)); });
      return spelling.length > 0;
    }, "the diagnostics");
    expect(spelling).toEqual(["teh"]);
  }, 30_000);

  it("shows a failed install with Retry, and Not now hides it", async () => {
    const store = fakeStore();
    const view = makeView(french("Bonjour."), store);
    await until(() => panel(view) !== null, "the panel");
    press(view, "Install");
    store.pending[0]!.reject(new Error("Network is down."));
    await until(() => noticeText(view)?.startsWith("Could not") === true, "the error");
    expect(noticeText(view)).toBe("Could not install the French dictionary: Network is down.");
    expect(labels(view)).toEqual(["Retry", "Not now"]);
    expect(buttons(view).some((button) => button.disabled)).toBe(false);

    press(view, "Retry");
    expect(store.installs).toEqual(["fr", "fr"]);
    expect(noticeText(view)).toBe("Installing the French dictionary…");
    store.pending[1]!.reject(new Error("Still down"));
    await until(() => labels(view).includes("Retry"), "the second error");
    expect(noticeText(view)).toBe("Could not install the French dictionary: Still down.");

    press(view, "Not now");
    expect(panel(view)).toBeNull();
  }, 30_000);

  it("shows a checker that could not start with Retry, logs it, and Retry starts it", async () => {
    let failures = 1;
    const store: DictionaryStore = {
      ...fakeStore(),
      read: async () => {
        if (failures > 0) { failures -= 1; throw new Error("runtimeModule is not a function"); }
        return en!;
      },
    };
    const logged: { module: string; error: unknown; context?: Record<string, unknown> }[] = [];
    const logger: ILogger = {
      log: async () => undefined,
      error: async (module, error, context) => { logged.push({ module, error, ...(context && { context }) }); },
    };
    const doc = "\\documentclass{article}\n\\begin{document}\nTeh cat.\n\\end{document}\n";
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc, extensions: [createProofing({ store, enabled: true, disable: () => undefined }, "latex", logger)] }),
    });
    views.push(view);
    await until(() => panel(view) !== null, "the panel");
    expect(noticeText(view)).toBe("Spelling could not start: runtimeModule is not a function.");
    expect(labels(view)).toEqual(["Retry", "Dismiss"]);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.context).toEqual(expect.objectContaining({ language: "en-US" }));

    press(view, "Retry");
    await until(() => panel(view) === null, "the checker to start");
    expect(proofingStateOf(view.state)?.status).toBe("ready");
  }, 30_000);

  it("says an unsupported language has no spelling, until dismissed or the language changes", async () => {
    const store = fakeStore();
    const doc = "\\documentclass{article}\n\\usepackage[finnish]{babel}\n\\begin{document}\nHei.\n\\end{document}\n";
    const view = makeView(doc, store);
    expect(proofingStateOf(view.state)?.status).toBe("unsupported");
    expect(noticeText(view)).toBe("Spelling is not available for Finnish.");
    expect(labels(view)).toEqual(["Dismiss"]);
    press(view, "Dismiss");
    expect(panel(view)).toBeNull();

    const at = doc.indexOf("finnish");
    view.dispatch({ changes: { from: at, to: at + "finnish".length, insert: "french" } });
    await until(() => noticeText(view) === "No French dictionary installed.", "the French notice");
  }, 30_000);

  it("shows nothing when the language's dictionary is installed", async () => {
    const view = makeView("\\begin{document}\nHello.\n\\end{document}\n", fakeStore());
    await until(() => proofingStateOf(view.state)?.status === "ready", "the checker");
    expect(panel(view)).toBeNull();
  }, 30_000);
});
