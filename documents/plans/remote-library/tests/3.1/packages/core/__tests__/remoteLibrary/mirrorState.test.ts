/** Verifies the mirror hash table: strict parse, round trip through serialize, and the reset when the relay URL changes. */
import { parseMirrorState, serializeMirrorState, stateForRelay, type MirrorState } from "../../src/remoteLibrary/mirrorState";

const relay = "https://mirror.example.workers.dev";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function sample(): MirrorState {
  return {
    version: 1,
    relayUrl: relay,
    rows: {
      "index/papers.json": { hash: hashA, size: 120, kind: "papers" },
      "papers/ml/abc/notes.qmd": { hash: hashB, size: 42, kind: "notes" },
      "projects/thesis/main.tex": { hash: hashA, size: 7, kind: "source" },
      "decks/talk/deck.html": { hash: hashB, size: 1000, kind: "deck" },
    },
  };
}

describe("parseMirrorState", () => {
  it("3.1a round-trips a state through serializeMirrorState", () => {
    const state = sample();
    expect(parseMirrorState(serializeMirrorState(state))).toEqual(state);
  });

  it("3.1a round-trips an empty table", () => {
    const state: MirrorState = { version: 1, relayUrl: relay, rows: {} };
    expect(parseMirrorState(serializeMirrorState(state))).toEqual(state);
  });

  it("3.1a serializes to JSON text carrying version 1, the relay URL and the rows", () => {
    const parsed = JSON.parse(serializeMirrorState(sample()));
    expect(parsed.version).toBe(1);
    expect(parsed.relayUrl).toBe(relay);
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

  it("3.1a answers undefined for version 2", () => {
    const text = JSON.stringify({ ...sample(), version: 2 });
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

  it("3.1a answers undefined when relayUrl is missing", () => {
    const { relayUrl: _relayUrl, ...withoutUrl } = sample();
    expect(parseMirrorState(JSON.stringify(withoutUrl))).toBeUndefined();
  });

  it("3.1a answers undefined when rows is missing", () => {
    const { rows: _rows, ...withoutRows } = sample();
    expect(parseMirrorState(JSON.stringify(withoutRows))).toBeUndefined();
  });
});

describe("stateForRelay", () => {
  it("3.1b keeps the rows for the same relay URL", () => {
    const state = sample();
    const result = stateForRelay(state, relay);
    expect(result).toEqual(state);
    expect(Object.keys(result.rows)).toHaveLength(4);
  });

  it("3.1b empties the rows for another relay URL and carries the new URL", () => {
    const result = stateForRelay(sample(), "https://other.example.workers.dev");
    expect(result).toEqual({ version: 1, relayUrl: "https://other.example.workers.dev", rows: {} });
  });

  it("3.1b answers an empty table for the relay when there is no state", () => {
    expect(stateForRelay(undefined, relay)).toEqual({ version: 1, relayUrl: relay, rows: {} });
  });

  it("3.1b leaves the input state untouched when it resets", () => {
    const state = sample();
    stateForRelay(state, "https://other.example.workers.dev");
    expect(state).toEqual(sample());
  });
});
