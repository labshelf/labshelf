/**
 * Declares the per-reader state and helpers the message handlers share, and the shape of the handler table.
 */
import type { Annotation, PdfTheme } from "../../model/index.js";
import type { EffectiveTheme, WebviewToHost } from "../protocol.js";
import type { ReaderHostPorts } from "./ports.js";

export const READER_LOG_MODULE = "reader";

export interface HostState {
  themePreference: PdfTheme;
  /** True once the reader has laid out the document; scrollToPage before that is dropped by the reader. */
  ready: boolean;
  pendingPage: number | undefined;
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

export type MessageHandler<C extends WebviewToHost["command"]> = (
  ctx: HostContext,
  msg: Extract<WebviewToHost, { command: C }>,
) => Promise<void> | void;

export type MessageHandlers = { [C in WebviewToHost["command"]]: MessageHandler<C> };
