/** The shared reader host: the controller that answers reader messages, the ports each host implements, and the Markdown export. */
export { ReaderHostController, type ReaderHostOptions } from "./hostController.js";
export { exportAnnotations } from "./exportAnnotations.js";
export type {
  ExportAnnotationsPorts,
  NoticeKind,
  ReaderActivityPort,
  ReaderHostPorts,
  ReaderSidecarStore,
  SidecarChange,
} from "./ports.js";
