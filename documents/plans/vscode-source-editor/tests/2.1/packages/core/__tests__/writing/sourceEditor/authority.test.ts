// Pins the source authority (D4): one document's text and versions, late client updates rebased, external changes recorded, CRLF kept, no lost or doubled character.
import { ChangeSet, Text } from "@codemirror/state";
import { createSourceAuthority, type SourceAuthority, type SourceUpdate, type TextChange } from "../../../src/writing/sourceEditor/authority";

/** Applies changes that all refer to the same original text (the way a WorkspaceEdit or a CodeMirror change spec does). */
function applyChanges(text: string, changes: readonly TextChange[]): string {
  let out = text;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("source authority", () => {
  it("2.1a accepts a client update on the current version unchanged and text() reflects it", () => {
    const authority = createSourceAuthority({ text: "hello", lineBreak: "\n" });
    expect(authority.version).toBe(0);
    expect(authority.text()).toBe("hello");
    const accepted = authority.receive(0, [{ clientID: "c1", changes: [{ from: 5, to: 5, insert: " world" }] }]);
    expect(accepted).toEqual([[{ from: 5, to: 5, insert: " world" }]]);
    expect(authority.text()).toBe("hello world");
    expect(authority.version).toBe(1);
  });

  it("2.1a accepts several updates of one push in order, each on top of the previous", () => {
    const authority = createSourceAuthority({ text: "abc", lineBreak: "\n" });
    const accepted = authority.receive(0, [
      { clientID: "c1", changes: [{ from: 0, to: 0, insert: "X" }] },
      { clientID: "c1", changes: [{ from: 4, to: 4, insert: "Y" }] },
    ]);
    expect(accepted).toHaveLength(2);
    expect(authority.text()).toBe("XabcY");
    expect(authority.version).toBe(2);
  });

  it("2.1a accepts a replacement and a deletion", () => {
    const authority = createSourceAuthority({ text: "one two three", lineBreak: "\n" });
    authority.receive(0, [{ clientID: "c1", changes: [{ from: 4, to: 7, insert: "2" }] }]);
    expect(authority.text()).toBe("one 2 three");
    authority.receive(1, [{ clientID: "c1", changes: [{ from: 3, to: 5, insert: "" }] }]);
    expect(authority.text()).toBe("one three");
  });

  it("2.1b rebases a client update made before an external change so both characters are present exactly once", () => {
    const authority = createSourceAuthority({ text: "abc", lineBreak: "\n" });
    let host = "abc";
    authority.external([{ from: 3, to: 3, insert: "X" }]);
    host = applyChanges(host, [{ from: 3, to: 3, insert: "X" }]);
    expect(authority.version).toBe(1);

    const accepted = authority.receive(0, [{ clientID: "c1", changes: [{ from: 0, to: 0, insert: "Y" }] }]);
    expect(accepted).toBeDefined();
    for (const changes of accepted!) host = applyChanges(host, changes);

    expect(authority.text()).toBe("YabcX");
    expect(host).toBe("YabcX");
    expect(authority.version).toBe(2);
  });

  it("2.1b keeps both inserts once when they land at the same position", () => {
    const authority = createSourceAuthority({ text: "abc", lineBreak: "\n" });
    let host = "abc";
    authority.external([{ from: 3, to: 3, insert: "X" }]);
    host = applyChanges(host, [{ from: 3, to: 3, insert: "X" }]);
    const accepted = authority.receive(0, [{ clientID: "c1", changes: [{ from: 3, to: 3, insert: "Y" }] }]);
    for (const changes of accepted!) host = applyChanges(host, changes);

    expect(authority.text()).toBe(host);
    expect(authority.text()).toHaveLength(5);
    expect(count(authority.text(), "X")).toBe(1);
    expect(count(authority.text(), "Y")).toBe(1);
    expect(authority.text().startsWith("abc")).toBe(true);
  });

  it("2.1b does not double a character when an external deletion overlaps a client deletion", () => {
    const authority = createSourceAuthority({ text: "0123456789", lineBreak: "\n" });
    let host = "0123456789";
    authority.external([{ from: 2, to: 6, insert: "" }]);
    host = applyChanges(host, [{ from: 2, to: 6, insert: "" }]);
    const accepted = authority.receive(0, [{ clientID: "c1", changes: [{ from: 4, to: 8, insert: "" }] }]);
    for (const changes of accepted!) host = applyChanges(host, changes);

    expect(authority.text()).toBe("0189");
    expect(host).toBe("0189");
  });

  it("2.1b rebases the second of two client updates over the same external change", () => {
    const authority = createSourceAuthority({ text: "abc", lineBreak: "\n" });
    let host = "abc";
    authority.external([{ from: 0, to: 0, insert: "E" }]);
    host = applyChanges(host, [{ from: 0, to: 0, insert: "E" }]);
    const accepted = authority.receive(0, [
      { clientID: "c1", changes: [{ from: 3, to: 3, insert: "1" }] },
      { clientID: "c1", changes: [{ from: 4, to: 4, insert: "2" }] },
    ]);
    for (const changes of accepted!) host = applyChanges(host, changes);
    expect(authority.text()).toBe("Eabc12");
    expect(host).toBe("Eabc12");
  });

  it("2.1c since(v) returns the external and accepted updates after v in order", () => {
    const authority = createSourceAuthority({ text: "abc", lineBreak: "\n" });
    authority.external([{ from: 3, to: 3, insert: "X" }]);
    authority.receive(1, [{ clientID: "c1", changes: [{ from: 0, to: 0, insert: "Y" }] }]);
    authority.external([{ from: 5, to: 5, insert: "Z" }]);
    expect(authority.version).toBe(3);

    const all: SourceUpdate[] = [
      { clientID: "host", changes: [{ from: 3, to: 3, insert: "X" }] },
      { clientID: "c1", changes: [{ from: 0, to: 0, insert: "Y" }] },
      { clientID: "host", changes: [{ from: 5, to: 5, insert: "Z" }] },
    ];
    expect(authority.since(0)).toEqual(all);
    expect(authority.since(1)).toEqual(all.slice(1));
    expect(authority.since(2)).toEqual(all.slice(2));
    expect(authority.since(3)).toEqual([]);
  });

  it("2.1c since(v) returns a late client update in its rebased form", () => {
    const authority = createSourceAuthority({ text: "abc", lineBreak: "\n" });
    authority.external([{ from: 0, to: 0, insert: "E" }]);
    authority.receive(0, [{ clientID: "c1", changes: [{ from: 3, to: 3, insert: "Y" }] }]);
    expect(authority.since(1)).toEqual([{ clientID: "c1", changes: [{ from: 4, to: 4, insert: "Y" }] }]);
  });

  it("2.1d keeps CRLF in text() and maps a client change in LF space to the CRLF offset", () => {
    const authority = createSourceAuthority({ text: "a\r\nb\r\nc", lineBreak: "\r\n" });
    expect(authority.text()).toBe("a\r\nb\r\nc");
    // In LF space the text is "a\nb\nc": offset 2 is before "b", which is offset 3 in the file.
    const accepted = authority.receive(0, [{ clientID: "c1", changes: [{ from: 2, to: 2, insert: "X" }] }]);
    expect(accepted).toEqual([[{ from: 3, to: 3, insert: "X" }]]);
    expect(authority.text()).toBe("a\r\nXb\r\nc");
  });

  it("2.1d maps a client deletion across a line break to the two-character break in the file", () => {
    const authority = createSourceAuthority({ text: "a\r\nb\r\nc", lineBreak: "\r\n" });
    // LF space: delete "\nb" (offsets 1 to 3); in the file that is "\r\nb" (offsets 1 to 4).
    const accepted = authority.receive(0, [{ clientID: "c1", changes: [{ from: 1, to: 3, insert: "" }] }]);
    expect(accepted).toEqual([[{ from: 1, to: 4, insert: "" }]]);
    expect(authority.text()).toBe("a\r\nc");
  });

  it("2.1d writes a line break typed by the client as CRLF", () => {
    const authority = createSourceAuthority({ text: "ab", lineBreak: "\r\n" });
    authority.receive(0, [{ clientID: "c1", changes: [{ from: 1, to: 1, insert: "\n" }] }]);
    expect(authority.text()).toBe("a\r\nb");
    expect(authority.text()).not.toMatch(/(^|[^\r])\n/);
  });

  it("2.1d turns an external change at a CRLF file offset into LF space for clients", () => {
    const authority = createSourceAuthority({ text: "a\r\nb\r\nc", lineBreak: "\r\n" });
    authority.external([{ from: 3, to: 3, insert: "E" }]);
    expect(authority.text()).toBe("a\r\nEb\r\nc");
    expect(authority.since(0)).toEqual([{ clientID: "host", changes: [{ from: 2, to: 2, insert: "E" }] }]);
  });

  it("2.1d keeps an LF file free of carriage returns", () => {
    const authority = createSourceAuthority({ text: "a\nb", lineBreak: "\n" });
    authority.receive(0, [{ clientID: "c1", changes: [{ from: 1, to: 1, insert: "\n" }] }]);
    expect(authority.text()).toBe("a\n\nb");
  });

  it("2.1e returns undefined when the base version is older than the kept history", () => {
    const authority = createSourceAuthority({ text: "abc", lineBreak: "\n", historyLimit: 3 });
    for (let i = 0; i < 5; i += 1) authority.external([{ from: 0, to: 0, insert: "x" }]);
    expect(authority.version).toBe(5);
    const before = authority.text();
    expect(authority.receive(0, [{ clientID: "c1", changes: [{ from: 0, to: 0, insert: "Y" }] }])).toBeUndefined();
    expect(authority.text()).toBe(before);
    expect(authority.version).toBe(5);
  });

  it("2.1e still accepts a client exactly at the edge of the kept history", () => {
    const authority = createSourceAuthority({ text: "abc", lineBreak: "\n", historyLimit: 3 });
    for (let i = 0; i < 5; i += 1) authority.external([{ from: 0, to: 0, insert: "x" }]);
    const accepted = authority.receive(2, [{ clientID: "c1", changes: [{ from: 0, to: 0, insert: "Y" }] }]);
    expect(accepted).toBeDefined();
    expect(count(authority.text(), "Y")).toBe(1);
  });

  it("2.1e returns undefined for a version the authority has not reached", () => {
    const authority = createSourceAuthority({ text: "abc", lineBreak: "\n" });
    expect(authority.receive(7, [{ clientID: "c1", changes: [{ from: 0, to: 0, insert: "Y" }] }])).toBeUndefined();
    expect(authority.text()).toBe("abc");
  });

  it("2.1e keeps the default history of 500 updates", () => {
    const authority = createSourceAuthority({ text: "", lineBreak: "\n" });
    for (let i = 0; i < 400; i += 1) authority.external([{ from: 0, to: 0, insert: "x" }]);
    expect(authority.receive(0, [{ clientID: "c1", changes: [{ from: 0, to: 0, insert: "Y" }] }])).toBeDefined();
    for (let i = 0; i < 600; i += 1) authority.external([{ from: 0, to: 0, insert: "x" }]);
    expect(authority.receive(0, [{ clientID: "c1", changes: [{ from: 0, to: 0, insert: "Z" }] }])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Convergence (A3): a simulated collab client and a host document, driven by a seeded random schedule of edits.

function toChangeSet(changes: readonly TextChange[], length: number): ChangeSet {
  return ChangeSet.of(changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })), length);
}

function toTextChanges(set: ChangeSet): TextChange[] {
  const out: TextChange[] = [];
  set.iterChanges((from, to, _fromB, _toB, inserted) => out.push({ from, to, insert: inserted.toString() }));
  return out;
}

/** What @codemirror/collab's client does: unconfirmed local changes, remote updates rebased over them, own updates dropped when echoed. */
class SimulatedClient {
  confirmed: Text;
  doc: Text;
  version: number;
  unconfirmed: ChangeSet[] = [];
  constructor(readonly id: string, text: string, version: number) {
    this.confirmed = Text.of(text.split("\n"));
    this.doc = this.confirmed;
    this.version = version;
  }
  edit(change: TextChange): void {
    const set = toChangeSet([change], this.doc.length);
    this.doc = set.apply(this.doc);
    this.unconfirmed.push(set);
  }
  push(authority: SourceAuthority): TextChange[][] | undefined {
    if (this.unconfirmed.length === 0) return [];
    const updates: SourceUpdate[] = this.unconfirmed.map((set) => ({ clientID: this.id, changes: toTextChanges(set) }));
    return authority.receive(this.version, updates);
  }
  pull(authority: SourceAuthority): void {
    for (const update of authority.since(this.version)) {
      this.version += 1;
      if (update.clientID === this.id) {
        const own = this.unconfirmed.shift();
        if (!own) throw new Error("confirmation without an unconfirmed update");
        this.confirmed = own.apply(this.confirmed);
        continue;
      }
      const remote = toChangeSet(update.changes, this.confirmed.length);
      this.confirmed = remote.apply(this.confirmed);
      let over = remote;
      const rebased: ChangeSet[] = [];
      for (const local of this.unconfirmed) {
        rebased.push(local.map(over));
        over = over.map(local, true);
      }
      this.unconfirmed = rebased;
      this.doc = over.apply(this.doc);
    }
  }
}

interface World {
  authority: SourceAuthority;
  client: SimulatedClient;
  host: string;
  lineBreak: "\n" | "\r\n";
}

function randomText(rand: () => number, alphabet: readonly string[], max: number): string {
  let out = "";
  for (let n = Math.floor(rand() * (max + 1)); n > 0; n -= 1) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

function run(seed: number, lineBreak: "\n" | "\r\n", steps: number): World {
  const rand = mulberry32(seed);
  const initialLf = "alpha\nbeta\ngamma\ndelta";
  const initial = initialLf.split("\n").join(lineBreak);
  const authority = createSourceAuthority({ text: initial, lineBreak });
  const client = new SimulatedClient("c1", initialLf, authority.version);
  const world: World = { authority, client, host: initial, lineBreak };
  const clientAlphabet = ["p", "q", "\n", "r"];
  const hostAlphabet = lineBreak === "\n" ? ["x", "y", "\n", "z"] : ["x", "y", "\r\n", "z"];

  const syncPush = (): void => {
    const accepted = client.push(authority);
    expect(accepted).toBeDefined();
    for (const changes of accepted!) world.host = applyChanges(world.host, changes);
  };

  for (let step = 0; step < steps; step += 1) {
    const action = rand();
    if (action < 0.4) {
      const len = client.doc.length;
      const from = Math.floor(rand() * (len + 1));
      const to = Math.min(len, from + Math.floor(rand() * 4));
      client.edit({ from, to, insert: randomText(rand, clientAlphabet, 3) });
    } else if (action < 0.7) {
      // A valid host boundary never falls between "\r" and "\n".
      const boundaries: number[] = [];
      for (let i = 0; i <= world.host.length; i += 1) if (!(world.host[i - 1] === "\r" && world.host[i] === "\n")) boundaries.push(i);
      const a = boundaries[Math.floor(rand() * boundaries.length)]!;
      const wide = rand() < 0.5 ? boundaries.filter((b) => b >= a && b <= a + 6) : [a];
      const b = wide[Math.floor(rand() * wide.length)]!;
      const change = { from: a, to: b, insert: randomText(rand, hostAlphabet, 3) };
      world.host = applyChanges(world.host, [change]);
      authority.external([change]);
    } else if (action < 0.85) {
      syncPush();
      client.pull(authority);
    } else {
      client.pull(authority);
    }
  }
  // Drain: push what is left, then pull everything.
  syncPush();
  client.pull(authority);
  client.pull(authority);
  return world;
}

describe("source authority convergence", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])("A3 converges for seed %i with LF text", (seed) => {
    const { authority, client, host } = run(seed, "\n", 60);
    expect(authority.text()).toBe(host);
    expect(client.doc.toString()).toBe(authority.text());
    expect(client.unconfirmed).toHaveLength(0);
    expect(client.version).toBe(authority.version);
  });

  it.each([21, 22, 23, 24, 25, 26, 27, 28])("A3 converges for seed %i with CRLF text and keeps it CRLF", (seed) => {
    const { authority, client, host } = run(seed, "\r\n", 60);
    expect(authority.text()).toBe(host);
    expect(client.doc.toString().split("\n").join("\r\n")).toBe(authority.text());
    expect(authority.text()).not.toMatch(/(^|[^\r])\n/);
    expect(authority.text()).not.toMatch(/\r(?!\n)/);
    expect(client.unconfirmed).toHaveLength(0);
  });

  it("A3 converges when the client is several external changes behind with several unsent edits", () => {
    const authority = createSourceAuthority({ text: "0123456789", lineBreak: "\n" });
    const client = new SimulatedClient("c1", "0123456789", 0);
    let host = "0123456789";
    client.edit({ from: 2, to: 4, insert: "ab" });
    client.edit({ from: 0, to: 0, insert: "<" });
    client.edit({ from: 11, to: 11, insert: ">" });
    for (const change of [{ from: 1, to: 3, insert: "" }, { from: 5, to: 5, insert: "EE" }, { from: 0, to: 2, insert: "Q" }]) {
      host = applyChanges(host, [change]);
      authority.external([change]);
    }
    const accepted = client.push(authority);
    expect(accepted).toBeDefined();
    for (const changes of accepted!) host = applyChanges(host, changes);
    client.pull(authority);
    expect(authority.text()).toBe(host);
    expect(client.doc.toString()).toBe(host);
  });
});
