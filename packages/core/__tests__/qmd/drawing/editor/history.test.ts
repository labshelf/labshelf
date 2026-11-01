import { createEditorState, type EditorState } from "../../../../src/qmd/drawing/editor/state";
import { applyEvent } from "../../../../src/qmd/drawing/editor/gestures";
import { createHistory } from "../../../../src/qmd/drawing/editor/history";
import type { DrawingModel } from "../../../../src/qmd/drawing/model";

const SCALE = 20;
const empty = () => ({ v: 1, points: [], items: [] }) as unknown as DrawingModel;
const pointCount = (s: EditorState) => (s.model as unknown as { points: unknown[] }).points.length;
const addPoint = (s: EditorState, x: number, y: number) => applyEvent(s, { type: "dblclick", x, y, shift: false, alt: false, mod: false, target: null }, SCALE);

describe("A5 undo and redo per gesture", () => {
  it("A5 undo returns the state before the last pushed gesture", () => {
    const s0 = createEditorState(empty());
    const s1 = addPoint(s0, 3, 4);
    const h = createHistory(s0).push(s1);
    expect(h.state).toBe(s1);
    expect(pointCount(h.undo().state)).toBe(0);
  });

  it("A5 redo returns the state that was undone", () => {
    const s0 = createEditorState(empty());
    const s1 = addPoint(s0, 3, 4);
    const h = createHistory(s0).push(s1).undo().redo();
    expect(h.state.model).toEqual(s1.model);
    expect(pointCount(h.state)).toBe(1);
  });

  it("A5 each gesture is one step back", () => {
    const s0 = createEditorState(empty());
    const s1 = addPoint(s0, 3, 4);
    const s2 = addPoint(s1, 6, 4);
    const s3 = addPoint(s2, 9, 4);
    const h = createHistory(s0).push(s1).push(s2).push(s3);
    expect(pointCount(h.state)).toBe(3);
    expect(pointCount(h.undo().state)).toBe(2);
    expect(pointCount(h.undo().undo().state)).toBe(1);
    expect(pointCount(h.undo().undo().redo().state)).toBe(2);
  });

  it("A5 undo with nothing to undo keeps the state", () => {
    const s0 = createEditorState(empty());
    const h = createHistory(s0);
    expect(h.undo().state).toEqual(h.state);
    expect(pointCount(h.undo().state)).toBe(0);
  });

  it("A5 redo with nothing to redo keeps the state", () => {
    const s0 = createEditorState(empty());
    const h = createHistory(s0).push(addPoint(s0, 3, 4));
    expect(pointCount(h.redo().state)).toBe(1);
  });

  it("A5 pushing after an undo drops the redo branch", () => {
    const s0 = createEditorState(empty());
    const s1 = addPoint(s0, 3, 4);
    const s1b = addPoint(s0, 7, 7);
    const h = createHistory(s0).push(s1).undo().push(s1b);
    expect(h.redo().state.model).toEqual(s1b.model);
    expect(h.undo().state.model).toEqual(s0.model);
  });

  it("A5 undo and redo do not change the history they are called on", () => {
    const s0 = createEditorState(empty());
    const s1 = addPoint(s0, 3, 4);
    const h = createHistory(s0).push(s1);
    h.undo();
    expect(h.state).toBe(s1);
  });
});
