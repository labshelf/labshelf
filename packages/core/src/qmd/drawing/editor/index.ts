// The drawing editor's runtime-neutral API: state, gestures, history and snapping.
export { createEditorState, itemIndexOf, itemKey, type Draft, type EditorState, type HitTarget, type Tool } from "./state.js";
export { applyEvent, commitLabel, type EditorEvent } from "./gestures.js";
export { createHistory, type EditorHistory } from "./history.js";
export { snapPosition, type SnapInput, type SnapResult } from "./snap.js";
