/**
 * Declares the per-reader state and helpers the message handlers share, and the shape of the handler table.
 */
import type { Annotation, PdfTheme } from "../../model/index.js";
import type { EffectiveTheme, HostToWebview, WebviewToHost } from "../protocol/index.js";
import type { ReaderHostPorts } from "./ports.js";

export const READER_LOG_MODULE = "reader";

export interface HostState {
  themePreference: PdfTheme;
  /** True once the reader has laid out the document; the reader drops every message but `init` and `applyTheme` before that. */
  ready: boolean;
  /** Messages held until `ready`, the latest one per type. */
  held: Map<HostToWebview["type"], HostToWebview>;
  /** JSON of the annotations the reader last received, so an unchanged list is not pushed again. */
  lastAnnotationsKey: string;
  openedAt: number;
}

export interface HostContext {
  readonly ports: ReaderHostPorts;
  readonly state: HostState;
  now(): number;
  effectiveTheme(theme: PdfTheme): EffectiveTheme;
  /** Posts the list unless it equals the last one sent; `force` posts it regardless. */
  pushAnnotations(annotations: Annotation[], force: boolean): void;
}

export type MessageAnswer<C extends WebviewToHost["command"]> = (
  ctx: HostContext,
  msg: Extract<WebviewToHost, { command: C }>,
) => Promise<void> | void;

export type MessageAnswers = { [C in WebviewToHost["command"]]: MessageAnswer<C> };
