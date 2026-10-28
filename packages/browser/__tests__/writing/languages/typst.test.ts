// The Typst completion maps the core language service's result to editor completions, with the library's papers first after an `@`.
import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { ILogger, PaperRecord } from "@labshelf/core";
import { createTypstLanguageService } from "@labshelf/core/typst/language";
import { createTypstCompletion } from "../../../src/writing/languages/typst";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const files: Record<string, string> = { "main.typ": "", "refs.bib": "@article{smith2020,\n  title = {Waves},\n}\n" };
const sources = { list: async () => Object.keys(files), read: async (path: string) => files[path] ?? "" };
const service = createTypstLanguageService({ sources, logger });
const paper = (citeKey: string): PaperRecord => ({ citeKey, title: "Waves", authors: ["Smith"], year: "2020" }) as unknown as PaperRecord;

async function complete(text: string, papers: PaperRecord[] = []): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc: text });
  const source = createTypstCompletion(service, "main.typ", async () => papers);
  const result = await source(new CompletionContext(state, text.length, true));
  return result as CompletionResult | null;
}

const apply = (option: Completion): unknown => option.apply;

describe("createTypstCompletion", () => {
  it("starts at the service's range and turns snippet items into snippet functions", async () => {
    const result = await complete("#tab");
    expect(result?.from).toBe(1);
    const table = result?.options.find((option) => option.label === "table");
    expect(table).toBeDefined();
    expect(typeof apply(table!)).toBe("function");
    const plain = result?.options.find((option) => typeof apply(option) === "string");
    expect(plain?.type).toBeDefined();
  });

  it("puts the library's papers first after an @ and drops the duplicate citation key", async () => {
    const result = await complete("see @", [paper("smith2020")]);
    expect(result?.options[0]?.apply).toBe("smith2020");
    expect(result?.options.filter((option) => option.label === "smith2020" || option.apply === "smith2020")).toHaveLength(1);
  });

  it("offers the library's papers when the service has nothing", async () => {
    const result = await complete("@", [paper("lee2021")]);
    expect(result?.options[0]?.apply).toBe("lee2021");
    expect(result?.from).toBe(1);
  });
});
