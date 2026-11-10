/** Verifies the mirror hash table: strict parse, round trip through serialize, and the reset when the Mirror generation changes. */
import { parseMirrorState, serializeMirrorState, stateForMirror, type MirrorState } from "../../src/remoteLibrary/mirrorState";

const relay = "gen-1";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function sample(): MirrorState {
  return {
    version: 2,
    generation: relay,
    rows: {
      "index/papers.json": { hash: hashA, size: 120, kind: "papers" },
      "papers/ml/abc/notes.qmd": { hash: hashB, size: 42, kind: "notes" },
      "projects/thesis/main.tex": { hash: hashA, size: 7, kind: "source" },
      "decks/talk/deck.html": { hash: hashB, size: 1000, kind: "deck" },
      "spaces/s1/space.json": { hash: hashA, size: 30, kind: "space" },
      "home.json": { hash: hashB, size: 12, kind: "home" },
      "projects/thesis/main.pdf": { hash: hashA, size: 900, kind: "output" },
      "projects/thesis/fig.png": { hash: hashB, size: 80, kind: "asset" },
      "papers/ml/abc/paper.pdf": { hash: hashA, size: 5000, kind: "pdf" },
    },
  };
}

describe("parseMirrorState", () => {
  it("3.1a round-trips a state through serializeMirrorState", () => {
    const state = sample();
    expect(parseMirrorState(serializeMirrorState(state))).toEqual(state);
  });

  it("3.1a round-trips an empty table", () => {
    const state: MirrorState = { version: 2, generation: relay, rows: {} };
    expect(parseMirrorState(serializeMirrorState(state))).toEqual(state);
  });

  it("3.1a serializes to JSON text carrying version 2, the generation and the rows", () => {
    const parsed = JSON.parse(serializeMirrorState(sample()));
    expect(parsed.version).toBe(2);
    expect(parsed.generation).toBe(relay);
    expect(parsed.rows["index/papers.json"]).toEqual({ hash: hashA, size: 120, kind: "papers" });
  });

  it("3.1a answers undefined for malformed JSON", () => {
    expect(parseMirrorState("{not json")).toBeUndefined();
    expect(parseMirrorState("")).toBeUndefined();
  });

  it("3.1a answers undefined for JSON that is not an object", () => {
    expect(parseMirrorState("null")).toBeUndefined();
    expect(parseMirrorState("[]")).toBeUndefined();
    expect(parseMirrorState("42")).toBeUndefined();
  });

  it("3.1a answers undefined for a version 1 table keyed by relay URL", () => {
    const text = JSON.stringify({ version: 1, relayUrl: "https://r.example", rows: {} });
    expect(parseMirrorState(text)).toBeUndefined();
  });

  it("3.1a answers undefined when the version is missing", () => {
    const { version: _version, ...rest } = sample();
    expect(parseMirrorState(JSON.stringify(rest))).toBeUndefined();
  });

  it("3.1a answers undefined for a row without hash", () => {
    const state = sample();
    const text = JSON.stringify({ ...state, rows: { ...state.rows, "broken.tex": { size: 3, kind: "source" } } });
    expect(parseMirrorState(text)).toBeUndefined();
  });

  it("3.1a answers undefined for a row without size", () => {
    const state = sample();
    const text = JSON.stringify({ ...state, rows: { ...state.rows, "broken.tex": { hash: hashA, kind: "source" } } });
    expect(parseMirrorState(text)).toBeUndefined();
  });

  it("3.1a answers undefined for a row without kind", () => {
    const state = sample();
    const text = JSON.stringify({ ...state, rows: { ...state.rows, "broken.tex": { hash: hashA, size: 3 } } });
    expect(parseMirrorState(text)).toBeUndefined();
  });

  it("3.1a answers undefined when generation is missing", () => {
    const { generation: _generation, ...withoutUrl } = sample();
    expect(parseMirrorState(JSON.stringify(withoutUrl))).toBeUndefined();
  });

  it("3.1a answers undefined when rows is missing", () => {
    const { rows: _rows, ...withoutRows } = sample();
    expect(parseMirrorState(JSON.stringify(withoutRows))).toBeUndefined();
  });
});

describe("stateForMirror", () => {
  it("3.1b keeps the rows for the same generation", () => {
    const state = sample();
    const result = stateForMirror(state, relay);
    expect(result).toEqual(state);
    expect(Object.keys(result.rows)).toHaveLength(9);
  });

  it("3.1b empties the rows for another generation and carries it", () => {
    const result = stateForMirror(sample(), "gen-2");
    expect(result).toEqual({ version: 2, generation: "gen-2", rows: {} });
  });

  it("3.1b answers an empty table for the generation when there is no state", () => {
    expect(stateForMirror(undefined, relay)).toEqual({ version: 2, generation: relay, rows: {} });
  });

  it("3.1b leaves the input state untouched when it resets", () => {
    const state = sample();
    stateForMirror(state, "gen-2");
    expect(state).toEqual(sample());
  });
});
