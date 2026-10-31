/** @jest-environment jsdom */
/**
 * Tests the install-hint copy buttons: renderInstallHints builds one div.qmd-output-install with a copy button per `Install it with: ` line and copies the command after the prefix,
 * and the output node view puts those buttons under the text of an error output while an output without such a line keeps its plain pre.
 */
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { formatOutput } from "../../../src/qmd/item/cellOutput";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { renderInstallHints } from "../../../src/qmd/dom/outputView";
import { showToast } from "../../../src/ui/dom/widgets/toast";
import { mount, until, settle } from "../../support/nodeViewHarness";

jest.mock("../../../src/ui/dom/widgets/toast", () => ({ showToast: jest.fn() }));

const PY_HINT = 'Install it with: "/usr/bin/python3" -m pip install numpy';
const PY_COMMAND = '"/usr/bin/python3" -m pip install numpy';
const R_HINT = 'Install it with: install.packages("ggplot2")';
const R_COMMAND = 'install.packages("ggplot2")';

const buttonOf = (el: ParentNode) => el.querySelector<HTMLButtonElement>("button.qmd-output-copy");
const ok = () => jest.fn(async (_text: string) => undefined);

beforeEach(() => jest.mocked(showToast).mockClear());

describe("5.3a a pip hint line", () => {
  it("5.3a gives one div.qmd-output-install holding one button.qmd-output-copy for the hint line", () => {
    const hints = renderInstallHints(`ModuleNotFoundError: numpy\n${PY_HINT}\n`, ok());
    expect(hints).toHaveLength(1);
    expect(hints[0]!.tagName).toBe("DIV");
    expect(hints[0]!.classList.contains("qmd-output-install")).toBe(true);
    expect(hints[0]!.querySelectorAll("button.qmd-output-copy")).toHaveLength(1);
  });

  it("5.3a makes the button a type=button with the clipboard icon, aria-label and title `Copy install command`", () => {
    const button = buttonOf(renderInstallHints(PY_HINT, ok())[0]!)!;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Copy install command");
    expect(button.getAttribute("title")).toBe("Copy install command");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("5.3a copies the command after the prefix when the button is clicked", () => {
    const copy = ok();
    buttonOf(renderInstallHints(PY_HINT, copy)[0]!)!.click();
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(PY_COMMAND);
  });

  it("5.3a copies nothing until the button is clicked", () => {
    const copy = ok();
    renderInstallHints(PY_HINT, copy);
    expect(copy).not.toHaveBeenCalled();
  });

  it("5.3a trims trailing whitespace from the copied command", () => {
    const copy = ok();
    buttonOf(renderInstallHints(`Install it with: pip install numpy \t  \n`, copy)[0]!)!.click();
    expect(copy).toHaveBeenCalledWith("pip install numpy");
  });

  it("5.3a trims a trailing carriage return from the copied command", () => {
    const copy = ok();
    buttonOf(renderInstallHints(`oops\r\nInstall it with: pip install numpy\r\nmore\r\n`, copy)[0]!)!.click();
    expect(copy).toHaveBeenCalledWith("pip install numpy");
  });

  it("5.3a shows the ok toast `Copied: <command>` after a successful copy", async () => {
    buttonOf(renderInstallHints(PY_HINT, ok())[0]!)!.click();
    await settle();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(`Copied: ${PY_COMMAND}`, "ok");
  });

  it("5.3a gives one hint element per hint line, each copying its own command", () => {
    const copy = ok();
    const hints = renderInstallHints(`${PY_HINT}\nnoise\n${R_HINT}\n`, copy);
    expect(hints).toHaveLength(2);
    buttonOf(hints[0]!)!.click();
    buttonOf(hints[1]!)!.click();
    expect(copy.mock.calls.map((call) => call[0])).toEqual([PY_COMMAND, R_COMMAND]);
  });

  it("5.3a copies with navigator.clipboard.writeText when no copy is injected", async () => {
    const writeText = jest.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    buttonOf(renderInstallHints(PY_HINT)[0]!)!.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(PY_COMMAND);
  });
});

describe("5.3b the R hint and a refused copy", () => {
  it("5.3b copies install.packages(\"ggplot2\") for the R hint", () => {
    const copy = ok();
    const hints = renderInstallHints(`Error in library(ggplot2)\n${R_HINT}\n`, copy);
    expect(hints).toHaveLength(1);
    buttonOf(hints[0]!)!.click();
    expect(copy).toHaveBeenCalledWith(R_COMMAND);
  });

  it("5.3b shows the error toast when the copy is refused", async () => {
    const copy = jest.fn(async (_text: string) => { throw new Error("denied"); });
    buttonOf(renderInstallHints(R_HINT, copy)[0]!)!.click();
    await settle();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("The clipboard refused the copy; select the command and copy it.", "error");
  });

  it("5.3b does not show the ok toast when the copy is refused", async () => {
    const copy = jest.fn(async (_text: string) => { throw new Error("denied"); });
    buttonOf(renderInstallHints(R_HINT, copy)[0]!)!.click();
    await settle();
    expect(jest.mocked(showToast).mock.calls.some((call) => call[1] === "ok")).toBe(false);
  });
});

describe("5.3c text without an install line", () => {
  it("5.3c gives no elements for text without the prefix", () => {
    expect(renderInstallHints("Traceback (most recent call last):\nValueError: bad\n", ok())).toEqual([]);
  });

  it("5.3c gives no elements for an empty text", () => {
    expect(renderInstallHints("", ok())).toEqual([]);
  });

  it("5.3c gives no elements when the prefix is not at the start of the line", () => {
    expect(renderInstallHints(`Hint: ${PY_HINT}\n  ${R_HINT}\n`, ok())).toEqual([]);
  });
});

const rawOf = (content: string, status?: "error") => formatOutput({ cell: "c", source: "s", engine: "python", ran: "2026-10-30", content, ...(status ? { status } : {}) });
const docOf = (content: string, status?: "error"): PmNode => s.node("doc", null, [s.node("output", { raw: rawOf(content, status) })]);
const mountOutput = (content: string, status?: "error") => mount(docOf(content, status), { output: (createOutputView as unknown as (math?: unknown, plotly?: unknown) => never)(async () => ({ renderMathSvg: () => "<svg></svg>" }), async () => ({})) });

describe("5.3a the output view with an install hint", () => {
  it("5.3a shows one copy button under the pre of an error output, in a div.qmd-output-text-block", async () => {
    const content = `ModuleNotFoundError: No module named 'numpy'\n${PY_HINT}\n`;
    const expected = renderInstallHints(content, ok()).length;
    const view = mountOutput(content, "error");
    await until(() => view.dom.querySelector(".qmd-output-text, .qmd-output-text-block") !== null);
    expect(expected).toBe(1);
    expect(view.dom.querySelectorAll("button.qmd-output-copy")).toHaveLength(1);
    const block = view.dom.querySelector(".qmd-output-text-block")!;
    expect(block.tagName).toBe("DIV");
    expect(block.children).toHaveLength(2);
    expect(block.children[0]!.tagName).toBe("PRE");
    expect(block.children[0]!.classList.contains("qmd-output-text")).toBe(true);
    expect(block.children[1]!.classList.contains("qmd-output-install")).toBe(true);
  });

  it("5.3a keeps the hint line in the text of the pre", async () => {
    const content = `ModuleNotFoundError: No module named 'numpy'\n${PY_HINT}\n`;
    renderInstallHints(content, ok());
    const view = mountOutput(content, "error");
    await until(() => view.dom.querySelector("pre.qmd-output-text") !== null);
    expect(view.dom.querySelector("pre.qmd-output-text")!.textContent).toContain(PY_HINT);
  });

  it("5.3a copies the command after the prefix when the button in the view is clicked", async () => {
    const writeText = jest.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const content = `ModuleNotFoundError: No module named 'numpy'\n${PY_HINT}\n`;
    renderInstallHints(content, ok());
    const view = mountOutput(content, "error");
    await until(() => buttonOf(view.dom) !== null);
    buttonOf(view.dom)!.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(PY_COMMAND);
    expect(showToast).toHaveBeenCalledWith(`Copied: ${PY_COMMAND}`, "ok");
  });

  it("5.3a also shows the button for a stored text output that is not an error", async () => {
    renderInstallHints(R_HINT, ok());
    const view = mountOutput(`${R_HINT}\n`);
    await until(() => buttonOf(view.dom) !== null);
    expect(view.dom.querySelectorAll("button.qmd-output-copy")).toHaveLength(1);
  });
});

describe("5.3c the output view without an install hint", () => {
  it("5.3c renders the same pre.qmd-output-text with no button and no wrapper", async () => {
    const content = "Traceback (most recent call last):\nValueError: bad\n";
    expect(renderInstallHints(content, ok())).toEqual([]);
    const view = mountOutput(content, "error");
    await until(() => view.dom.querySelector("pre.qmd-output-text") !== null);
    expect(view.dom.querySelector("button.qmd-output-copy")).toBeNull();
    expect(view.dom.querySelector(".qmd-output-install")).toBeNull();
    expect(view.dom.querySelector(".qmd-output-text-block")).toBeNull();
    expect(view.dom.querySelector("pre.qmd-output-text")!.textContent).toContain("ValueError: bad");
  });

  it("5.3c keeps the pre unwrapped for a plain text output", async () => {
    expect(renderInstallHints("42\n", ok())).toEqual([]);
    const view = mountOutput("42\n");
    await until(() => view.dom.querySelector("pre.qmd-output-text") !== null);
    expect(view.dom.querySelector("pre.qmd-output-text")!.parentElement!.classList.contains("qmd-output-text-block")).toBe(false);
    expect(view.dom.querySelector("button.qmd-output-copy")).toBeNull();
  });
});
