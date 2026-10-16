/** Exports the shared reader host's public API: the message controller, the ports each host implements, and the Markdown export. */
export { ReaderHostController, type ReaderHostOptions } from "./hostController.js";
export { exportAnnotations } from "./exportAnnotations.js";
export type {
  ExportAnnotationsPorts,
  NoticeKind,
  PreviewPorts,
  ReaderHostPorts,
  ReaderSidecarStore,
  SidecarChange,
} from "./ports.js";
