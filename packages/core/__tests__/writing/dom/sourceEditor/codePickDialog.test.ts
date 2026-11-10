/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the Insert code popup: it lists the code files, shows the picked file's code, describes what a selection of whole
// lines inserts (a definition by name) or the whole file without a selection, and Insert hands back that excerpt.
import { EditorView } from "@codemirror/view";
import { pickCodeExcerpt, type CodePickMemory, type CodePickSource } from "../../../../src/writing/dom/sourceEditor/codePickDialog";

const FIT = [
  "import numpy as np",
  "from scipy.optimize import curve_fit",
  "",
  "",
  "# Fits the model.",
  "def fit_model(t, observed):",
  "    def model(t, a, b):",
  "        return a * np.exp(-b * t)",
  "",
  "    params, _ = curve_fit(model, t, observed)",
  "    fitted = model(t, *params)",
  "    residuals = observed - fitted",
  "    return params, residuals",
  "",
].join("\n");

const FILES = ["scripts/plot.m", "../analysis/fit.py", "../analysis/simulate.jl", "../analysis/stats.R"];

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) { await new Promise((resolve) => setTimeout(resolve, 0)); } };

function source(): CodePickSource {
  return { list: async () => FILES, read: async (path) => (path === "../analysis/fit.py" ? FIT : undefined) };
}

const status = (): string => document.querySelector(".rd-cite-dialog-status")!.textContent ?? "";
const button = (label: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>(".rd-cite-dialog-actions button")].find((each) => each.textContent === label)!;
const codeView = (): EditorView => EditorView.findFromDOM(document.querySelector<HTMLElement>(".ls-code-pick-view .cm-editor")!)!;

async function pickFit(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(".rd-cite-dialog input[role=combobox]")!;
  input.dispatchEvent(new Event("focus"));
  const options = [...document.querySelectorAll<HTMLElement>(".ls-combobox-option")];
  expect(options.map((option) => option.textContent)).toEqual(FILES);
  input.value = "fit";
  input.dispatchEvent(new Event("input"));
  document.querySelector<HTMLElement>(".ls-combobox-option")!.click();
  await flush();
}

afterEach(() => { document.body.replaceChildren(); });

describe("pickCodeExcerpt", () => {
  it("lists the files, describes a selected definition by name and inserts it", async () => {
    const memory: CodePickMemory = {};
    const picked = pickCodeExcerpt(source(), memory);
    await flush();
    expect(document.querySelector(".rd-cite-dialog-title")!.textContent).toBe("Insert code");
    await pickFit();
    expect(codeView().state.doc.toString()).toBe(FIT);
    expect(status()).toBe("Whole file");
    const doc = codeView().state.doc;
    codeView().dispatch({ selection: { anchor: doc.line(6).from, head: doc.line(14).from } });
    expect(status()).toBe("fit_model in fit.py");
    expect(document.querySelectorAll(".ls-code-pick-line")).toHaveLength(8);
    button("Insert").click();
    const excerpt = await picked;
    expect(excerpt?.anchor).toEqual({ kind: "symbol", name: "fit_model" });
    expect(excerpt?.path).toBe("../analysis/fit.py");
    expect(memory.path).toBe("../analysis/fit.py");
    expect(document.querySelector(".rd-cite-dialog")).toBeNull();
  });

  it("inserts the whole file without a selection and describes other lines by number", async () => {
    const picked = pickCodeExcerpt(source(), {});
    await flush();
    await pickFit();
    const doc = codeView().state.doc;
    codeView().dispatch({ selection: { anchor: doc.line(10).from, head: doc.line(11).to } });
    expect(status()).toBe("lines 10–11 of fit.py");
    codeView().dispatch({ selection: { anchor: 0 } });
    expect(status()).toBe("Whole file");
    document.querySelector(".rd-cite-dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const excerpt = await picked;
    expect(excerpt?.anchor).toEqual({ kind: "file" });
  });

  it("opens on the file picked last and resolves undefined on Cancel", async () => {
    const picked = pickCodeExcerpt(source(), { path: "../analysis/fit.py" });
    await flush();
    expect(codeView().state.doc.toString()).toBe(FIT);
    button("Cancel").click();
    expect(await picked).toBeUndefined();
  });
});
