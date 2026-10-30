import { parseItemFile, serializeItemFile } from "../../../src/qmd/item/itemFile";
import { findOutputs } from "../../../src/qmd/item/cellOutput";
import { toCellLanguage, type CellLanguage } from "../../../src/qmd/compute/cellLanguage";
import { createCellRuns, toCellRunState, type CellResult, type CellRunState, type CellRunTarget, type CellRuns } from "../../../src/qmd/compute/cellRunner";
import { writeCellOutput } from "../../../src/qmd/compute/writeCellOutput";

// The meta engine is deliberately not a cell language: the written engine must come from the result's language.
const META = { engine: "stale-engine", ran: "2026-10-22T09:15:03.000Z" };
const CODE = "1 + 1\n";
const cell = (language: string, label = "c"): string => "```{" + language + "}\n#| label: " + label + "\n" + CODE + "```\n";

// Results and requests are built through casts so the file compiles against the types before and after the change.
const result = (language: CellLanguage, patch: Record<string, unknown> = {}): CellResult => ({ status: "ok", language, text: "2", durationMs: 4, ...patch }) as unknown as CellResult;
type RunRequest = Parameters<CellRuns["run"]>[1];
const request = (language: CellLanguage, label = "c"): RunRequest => ({ requestId: "r1", label, code: CODE, language, noteKey: "note-1" }) as unknown as RunRequest;

function target(initial: string): { host: CellRunTarget; body: () => string; states: string[]; writes: number } {
  const state = { body: initial, states: [] as string[], writes: 0 };
  const host: CellRunTarget = {
    read: async () => state.body,
    write: async (next) => { state.body = next; state.writes++; },
    push: () => undefined,
    post: (value: CellRunState) => { state.states.push(value); },
    fail: () => undefined,
  };
  return { host, body: () => state.body, states: state.states, get writes() { return state.writes; } };
}

describe("writeCellOutput engine", () => {
  it("1.2a writes engine mathematica for a mathematica cell", async () => {
    const language = toCellLanguage("mathematica")!;
    const written = await writeCellOutput(`Intro\n\n${cell("mathematica")}\nTail\n`, "c", result(language), META);
    expect(findOutputs(written)[0]!.engine).toBe("mathematica");
  });

  it("A1 writes engine python for a python cell", async () => {
    const language = toCellLanguage("python")!;
    const written = await writeCellOutput(`${cell("python")}\nTail\n`, "c", result(language), META);
    expect(findOutputs(written)[0]!.engine).toBe("python");
  });

  it("A1 writes engine r for an r cell", async () => {
    const language = toCellLanguage("r")!;
    const written = await writeCellOutput(`${cell("r")}\nTail\n`, "c", result(language), META);
    expect(findOutputs(written)[0]!.engine).toBe("r");
  });

  it("A1 writes the language as engine for an error result", async () => {
    const language = toCellLanguage("mathematica")!;
    const written = await writeCellOutput(`${cell("mathematica")}\n`, "c", result(language, { status: "error", error: "boom" }), META);
    expect(findOutputs(written)[0]!.engine).toBe("mathematica");
  });

  it("1.2b leaves the note body unchanged for a missing result", async () => {
    const language = toCellLanguage("mathematica")!;
    const body = `Intro\n\n${cell("mathematica")}\nTail\n`;
    expect(await writeCellOutput(body, "c", result(language, { status: "missing" }), META)).toBe(body);
  });

  it("1.2b leaves the body unchanged for a missing result of each language", async () => {
    for (const name of ["python", "mathematica", "r"]) {
      const language = toCellLanguage(name)!;
      const body = `${cell(name)}\nTail\n`;
      expect(await writeCellOutput(body, "c", result(language, { status: "missing" }), META)).toBe(body);
    }
  });

  it("1.2b keeps an existing output block when the result is missing", async () => {
    const language = toCellLanguage("r")!;
    const first = await writeCellOutput(`${cell("r")}\nTail\n`, "c", result(language), META);
    expect(await writeCellOutput(first, "c", result(language, { status: "missing" }), META)).toBe(first);
  });

  it("A1 keeps the fence language of the cell after writing an output into a mixed note", async () => {
    const language = toCellLanguage("mathematica")!;
    const body = `${cell("python", "p")}\n${cell("mathematica", "m")}\n${cell("r", "r1")}`;
    const written = await writeCellOutput(body, "m", result(language), META);
    expect(written).toContain("```{python}");
    expect(written).toContain("```{mathematica}");
    expect(written).toContain("```{r}");
    expect(findOutputs(written).map((output) => [output.cell, output.engine])).toEqual([["m", "mathematica"]]);
  });
});

describe("CellRuns.run engine", () => {
  it("A1 writes the request language as the engine of the stored output", async () => {
    const language = toCellLanguage("mathematica")!;
    const host = target(`Intro\n\n${cell("mathematica")}\nTail\n`);
    await createCellRuns().run(async () => result(language), request(language), host.host);
    expect(findOutputs(host.body())[0]!.engine).toBe("mathematica");
    expect(host.states).toEqual(["running", "done"]);
  });

  it("A1 writes engine r when an r request runs", async () => {
    const language = toCellLanguage("r")!;
    const host = target(`${cell("r")}\nTail\n`);
    await createCellRuns().run(async () => result(language), request(language), host.host);
    expect(findOutputs(host.body())[0]!.engine).toBe("r");
  });

  it("1.2b a missing result leaves the note body unchanged, writes nothing and posts missing", async () => {
    const language = toCellLanguage("mathematica")!;
    const body = `${cell("mathematica")}\nTail\n`;
    const host = target(body);
    await createCellRuns().run(async () => result(language, { status: "missing" }), request(language), host.host);
    expect(host.body()).toBe(body);
    expect(host.writes).toBe(0);
    expect(host.states).toEqual(["running", "missing"]);
  });
});

describe("cell status missing", () => {
  it("1.2d maps a missing result to the missing run state, and CellResult carries language and restarted", () => {
    const language = toCellLanguage("mathematica")!;
    // Compiles before and after the change; the shape below is the final CellResult.
    const shaped = result(language, { status: "missing", restarted: true });
    expect(shaped).toMatchObject({ status: "missing", language: "mathematica", restarted: true });
    expect(toCellRunState(shaped.status)).toBe("missing");
  });
});

describe("note body round trip", () => {
  it("A1 round-trips an item file with python, mathematica and r fences byte for byte", () => {
    const languages = ["python", "mathematica", "r"].map((name) => toCellLanguage(name));
    expect(languages).toEqual(["python", "mathematica", "r"]);
    const body = cell("python", "p") + "\n" + cell("mathematica", "m") + "\n" + cell("r", "r1");
    const text = `# Note\n\n::: {#a1 .labshelf-item}\n${body}:::\n\nTail\n`;
    const parsed = parseItemFile(text);
    expect(parsed.segments.some((segment) => segment.kind === "item")).toBe(true);
    expect(serializeItemFile(parsed)).toBe(text);
  });

  it("A1 round-trips CRLF fences of the three languages byte for byte", () => {
    expect(toCellLanguage("wolfram")).toBe("mathematica");
    const body = ["python", "mathematica", "r"].map((name, index) => cell(name, `c${index}`)).join("\n").replace(/\n/g, "\r\n");
    const text = `::: {#a2 .labshelf-item}\r\n${body}:::\r\n`;
    expect(serializeItemFile(parseItemFile(text))).toBe(text);
  });
});
