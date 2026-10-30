// Runtime-neutral source editor pieces shared by hosts: the per-document authority.
export { createSourceAuthority } from "./authority.js";
export type { SourceAuthority, SourceUpdate, TextChange } from "./authority.js";
export { parseSourceEditorInbound, parseSourceEditorOutbound } from "./protocol.js";
export type { SourceEditorInbound, SourceEditorOutbound } from "./protocol.js";
