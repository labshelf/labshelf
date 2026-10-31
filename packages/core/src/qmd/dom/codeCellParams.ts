// Wires a code cell's param strip to the cell: the params it draws, the drag previews it shows, and the release that writes the param lines and runs.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { CellLanguage, CellResult } from "../compute/index.js";
import { formatCellParamLine, parseCellParams, setCellParamValue, type CellParam } from "../item/index.js";
import { createCellParamStrip, paramsFromControls, withParamValue, type CellParamStrip, type CellParamValues } from "./cellParamStrip.js";
import { setViewNodeAttribute } from "./inlineViews.js";

/** Runs a cell with `params`; `preview` is called once with the result, or with undefined when the request ends without one. */
type PreviewRunner = (label: string, code: string, language: CellLanguage, params: CellParamValues, preview: (result: CellResult | undefined) => void) => void;

/** What the param wiring needs of the cell that owns it. */
export interface CellParamsHost {
  readonly view: EditorView;
  readonly getPos: () => number | undefined;
  /** The host's run, absent when the host does not run cells. */
  readonly runPreview: PreviewRunner | undefined;
  node(): ProseNode;
  language(): CellLanguage | undefined;
  label(): string;
  canRun(): boolean;
  /** A normal run with `values`. */
  run(values: CellParamValues): void;
  /** The preview result changed. */
  changed(): void;
}

export interface CellParams {
  readonly strip: CellParamStrip;
  /** The cell's own param lines. */
  declared(): CellParam[];
  /** Draws the strip from the param lines, or else from the last result's Manipulate controls. */
  render(): void;
  /** The result of the latest drag preview, shown in place of the stored output until the release run ends. */
  previewResult(): CellResult | null;
  /** The cell's run state changed: a release run drops the preview result when it ends; a param-less Manipulate cell then asks for its controls. */
  runChanged(running: boolean): void;
}

/** @returns `options` with `values` written: into the param lines, or (Manipulate controls) as new param lines. */
function writeParamValues(options: string, lines: CellParam[], controlParams: CellParam[], values: CellParamValues): string {
  if (lines.length > 0) return lines.reduce((next, param) => (values[param.name] === undefined ? next : setCellParamValue(next, param.name, values[param.name]!)), options);
  if (controlParams.length === 0) return options;
  const base = options === "" || options.endsWith("\n") ? options : `${options}\n`;
  return base + controlParams.map((param) => `${formatCellParamLine(withParamValue(param, values[param.name]))}\n`).join("");
}

/** @returns the param wiring of one cell; the strip is a sibling of the cell's panel, so a folded cell still shows it above its outputs. */
export function createCellParams(host: CellParamsHost): CellParams {
  const attr = (name: "options" | "code"): string => host.node().attrs[name] as string;
  const declared = (): CellParam[] => parseCellParams(attr("options"));
  /** The params the last result's Manipulate controls describe; drawn while the cell has no param lines. */
  let resultParams: CellParam[] = [];
  let previewResult: CellResult | null = null;
  /** Set by a release; the end of the next normal run drops the preview result. */
  let releaseRun: "pending" | "running" | null = null;
  const render = (): void => strip.render(declared().length > 0 ? declared() : resultParams, host.canRun());

  /** A drag preview: runs the cell with `values`, showing the result in place of the stored output. */
  const preview = (values: CellParamValues, done: () => void): void => {
    const language = host.language();
    if (!host.runPreview || !language) { done(); return; }
    host.runPreview(host.label(), attr("code"), language, values, (result) => {
      if (result && !host.view.isDestroyed) { previewResult = result; host.changed(); }
      done();
    });
  };

  /** A release: writes the values into the param lines in one step, then runs. */
  const release = (values: CellParamValues): void => {
    const next = writeParamValues(attr("options"), declared(), resultParams, values);
    if (next !== attr("options") && host.view.editable) setViewNodeAttribute(host.view, host.getPos, "options", next);
    releaseRun = "pending";
    host.run(values);
  };

  const strip = createCellParamStrip({ preview, release });
  const askForControls = (): void => {
    const language = host.language();
    if (!host.runPreview || language !== "mathematica" || declared().length > 0 || !attr("code").includes("Manipulate[")) return;
    host.runPreview(host.label(), attr("code"), language, {}, (result) => {
      if (!result?.controls || host.view.isDestroyed) return;
      resultParams = paramsFromControls(result.controls);
      render();
    });
  };

  return {
    strip, declared, render, previewResult: () => previewResult,
    runChanged(running) {
      if (running) { if (releaseRun === "pending") releaseRun = "running"; return; }
      if (releaseRun === "running") { releaseRun = null; previewResult = null; }
      askForControls();
    },
  };
}
