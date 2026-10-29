import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/compositionRoot";
import { App } from "../../../../src/libraryUi/libraryScreen";
import {
  ATTENTION, BERT, BERT_QUERY, EINSTEIN, LECUN, ZEBRA, eventually, goToFolder, highlight, hoveredId, idle, ids, makeTmpRoot, openApp, pane,
  press, seedLibrary, typeText, writeNotes, writeSidecar,
} from "../../../fixtures/appHarness";

let tmp: string;
let root: string;
let ctx: AppContext;
let app: App;

beforeEach(async () => {
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  await writeNotes(root, ZEBRA, "Check the stripes");
  ({ ctx, app } = await openApp(root, tmp));
});

afterEach(async () => {
  await idle(app).catch(() => undefined);
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("App filter (f)", () => {
  it("filters the list live while typing and Esc restores it", () => {
    press(app, "f");
    expect(app.inline?.purpose).toBe("filter");
    typeText(app, BERT_QUERY);
    expect(app.filter).toBe(BERT_QUERY);
    expect(ids(app)).toEqual([BERT]);
    expect(pane(app, "papers")).not.toContain("Attention Is All You Need");
    expect(pane(app, "status")).toContain("FILTER");
    press(app, "esc");
    expect(app.inline).toBeUndefined();
    expect(app.filter).toBe("");
    expect(ids(app)).toHaveLength(5);
    expect(pane(app, "papers")).toContain("Attention Is All You Need");
  });

  it("updates on every keystroke, including backspace", () => {
    press(app, "f");
    let typedSoFar = "";
    for (const ch of BERT_QUERY) {
      typeText(app, ch);
      typedSoFar += ch;
      expect(app.filter).toBe(typedSoFar);
    }
    expect(ids(app)).toEqual([BERT]);
    for (let i = BERT_QUERY.length - 1; i >= 0; i--) {
      press(app, "backspace");
      expect(app.filter).toBe(BERT_QUERY.slice(0, i));
    }
    expect(ids(app)).toHaveLength(5);
  });

  it("narrows the list as soon as the first letter is typed", () => {
    press(app, "f");
    typeText(app, "z");
    expect(ids(app).length).toBeLessThan(5);
    expect(ids(app)).toContain(ZEBRA);
  });

  it("keeps the filter on Enter and shows it in the status bar", () => {
    press(app, "f");
    typeText(app, BERT_QUERY);
    press(app, "enter");
    expect(app.inline).toBeUndefined();
    expect(app.filter).toBe(BERT_QUERY);
    expect(ids(app)).toEqual([BERT]);
    expect(pane(app, "status")).toContain(`f: ${BERT_QUERY}`);
    expect(pane(app, "status")).toContain("FILTER");
  });

  it("clears a kept filter with Esc in normal mode", () => {
    press(app, "f");
    typeText(app, BERT_QUERY);
    press(app, "enter", "esc");
    expect(app.filter).toBe("");
    expect(ids(app)).toHaveLength(5);
  });

  it("restores the previous filter, not an empty one, when editing is cancelled", () => {
    press(app, "f");
    typeText(app, BERT_QUERY);
    press(app, "enter", "f");
    expect(app.inline?.input.value).toBe(BERT_QUERY);
    typeText(app, "zzz");
    expect(ids(app)).toEqual([]);
    press(app, "esc");
    expect(app.filter).toBe(BERT_QUERY);
    expect(ids(app)).toEqual([BERT]);
  });

  it("explains an empty result", () => {
    press(app, "f");
    typeText(app, "zzzz");
    expect(ids(app)).toEqual([]);
    expect(pane(app, "papers")).toContain("No paper matches the filter.");
    expect(pane(app, "papers")).toContain("Esc clears it.");
  });

  it("understands the query language", () => {
    const filtered = (query: string): string[] => {
      press(app, "f", "C-u");
      typeText(app, query);
      press(app, "enter");
      const result = ids(app);
      press(app, "esc");
      return result;
    };
    expect(filtered("tag:nlp")).toEqual([ATTENTION]);
    expect(filtered("status:reading")).toEqual([BERT]);
    expect(filtered("year:2019")).toEqual([BERT]);
    expect(filtered("year:1900..1999")).toEqual([LECUN, EINSTEIN]);
    expect(filtered("author:einstein")).toEqual([EINSTEIN]);
    expect(filtered("no:pdf")).toEqual([EINSTEIN]);
    expect(filtered("has:note")).toEqual([ZEBRA]);
    expect(filtered("has:doi")).toEqual([ATTENTION]);
    expect(filtered("transformers -bert")).toEqual([ATTENTION]);
  });

  it("clears the filter when another folder is chosen", () => {
    press(app, "f");
    typeText(app, BERT_QUERY);
    press(app, "enter");
    press(app, "h", "j");
    expect(app.filter).toBe("");
  });

  it("moves the cursor with the arrow keys while typing", () => {
    press(app, "f", "down");
    expect(hoveredId(app)).toBe(BERT);
    press(app, "up");
    expect(hoveredId(app)).toBe(ATTENTION);
  });

  it("filters the folder being browsed", () => {
    goToFolder(app, "ML");
    press(app, "l", ".", "f");
    typeText(app, BERT_QUERY);
    expect(ids(app)).toEqual([BERT]);
  });

  it("accepts pasted text", () => {
    press(app, "f");
    app.handle({ type: "paste", text: "tag:nlp\n" });
    expect(app.filter).toBe("tag:nlp ");
    expect(ids(app)).toEqual([ATTENTION]);
  });
});

describe("App find (/)", () => {
  it("jumps the cursor to the first match while typing without hiding other papers", () => {
    press(app, "/");
    expect(app.inline?.purpose).toBe("find");
    typeText(app, "gradient");
    expect(hoveredId(app)).toBe(LECUN);
    expect(ids(app)).toHaveLength(5);
    press(app, "enter");
    expect(app.inline).toBeUndefined();
    expect(hoveredId(app)).toBe(LECUN);
  });

  it("steps through matches with n and N, wrapping around", () => {
    press(app, "/");
    typeText(app, "transformers");
    press(app, "enter");
    expect(hoveredId(app)).toBe(ATTENTION);
    press(app, "n");
    expect(hoveredId(app)).toBe(BERT);
    press(app, "n");
    expect(hoveredId(app)).toBe(ATTENTION);
    press(app, "N");
    expect(hoveredId(app)).toBe(BERT);
  });

  it("warns when there is no match", () => {
    press(app, "/");
    typeText(app, "zzzz");
    expect(app.message?.text).toBe('No match for "zzzz"');
    expect(app.message?.level).toBe("warn");
  });

  it("does nothing on n before anything was searched", () => {
    press(app, "n");
    expect(hoveredId(app)).toBe(ATTENTION);
    expect(app.message).toBeUndefined();
  });
});

describe("App library search (s)", () => {
  it("searches the whole library live and shows the query in the header", () => {
    goToFolder(app, "Physics");
    press(app, "l", "s");
    expect(app.inline?.purpose).toBe("search");
    typeText(app, BERT_QUERY);
    expect(app.search).toBe(BERT_QUERY);
    expect(pane(app, "header")).toContain("search ›");
    expect(pane(app, "header")).toContain(BERT_QUERY);
    expect(pane(app, "header")).toContain("1 result");
    expect(ids(app)).toEqual([BERT]);
    expect(pane(app, "papers")).toContain("BERT: Pre-training");
    expect(pane(app, "status")).toContain("SEARCH");
  });

  it("returns to the folder it started from with Esc", () => {
    goToFolder(app, "Physics");
    press(app, "l", "s");
    typeText(app, BERT_QUERY);
    press(app, "esc");
    expect(app.inline).toBeUndefined();
    expect(app.search).toBeUndefined();
    expect(app.folder).toBe("Physics");
    expect(pane(app, "header")).not.toContain("search ›");
    expect(ids(app)).toEqual([EINSTEIN]);
  });

  it("keeps the results on Enter and leaves the search with Esc", () => {
    press(app, "s");
    typeText(app, "einstein");
    press(app, "enter");
    expect(app.inline).toBeUndefined();
    expect(app.search).toBe("einstein");
    expect(ids(app)).toEqual([EINSTEIN]);
    expect(pane(app, "header")).toContain("search › einstein");
    press(app, "esc");
    expect(app.search).toBeUndefined();
    expect(ids(app)).toHaveLength(5);
  });

  it("leaves the search with h as well", () => {
    press(app, "s");
    typeText(app, "einstein");
    press(app, "enter", "h");
    expect(app.search).toBeUndefined();
    expect(pane(app, "header")).toContain("All papers");
  });

  it("shows every paper for an empty query", () => {
    press(app, "s");
    typeText(app, "x");
    press(app, "backspace");
    expect(app.search).toBe("");
    expect(pane(app, "header")).toContain("(everything)");
    expect(pane(app, "header")).toContain("5 results");
  });

  it("explains an empty result", () => {
    press(app, "s");
    typeText(app, "qqqqzzzz");
    expect(pane(app, "papers")).toContain("Nothing found.");
    expect(pane(app, "header")).toContain("0 results");
  });

  it("leaves the search when Enter confirms an empty query", () => {
    press(app, "s", "enter");
    expect(app.search).toBeUndefined();
    expect(ids(app)).toHaveLength(5);
  });

  it("finds a paper by the text of its highlights", async () => {
    await writeSidecar(root, ATTENTION, [highlight(ATTENTION, 2, "Compare with the RNN baseline")]);
    await ctx.store.reload();
    await eventually(async () => {
      ctx.store.setAnnotationText(await ctx.sidecars.annotationIndex(ctx.store.snapshot.papers.keys()));
      return ctx.store.search("baseline", { key: "title", reverse: false }).length === 1;
    }, "the highlight to be indexed", app);
    press(app, "s");
    typeText(app, "baseline");
    expect(ids(app)).toEqual([ATTENTION]);
  });

  it("applies the filter inside the results", () => {
    press(app, "s");
    typeText(app, "transformers");
    press(app, "enter");
    expect(ids(app).length).toBeGreaterThanOrEqual(2);
    press(app, "f");
    typeText(app, BERT_QUERY);
    expect(ids(app)).toEqual([BERT]);
  });
});
