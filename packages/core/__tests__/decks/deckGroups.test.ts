// Spec 8.1: flat data-group groups: deckGroupMembers and the group and ungroup edits.
// Written as if the file sat at packages/core/__tests__/decks/deckGroups.test.ts; relative imports are resolved from there.
import { applyDeckEdit, type DeckEdit } from "../../src/decks/deckEdit";
import { deckGroupMembers } from "../../src/decks/deckGroups";
import { parseDeck, type DeckModel } from "../../src/decks/deckParse";
import { validateDeck } from "../../src/decks/deckValidate";

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const FILES: ReadonlySet<string> = new Set(["theme.css"]);

function deckHtml(slides: string[]): string {
  return [
    "<!doctype html>",
    '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>Sample deck</title>",
    '  <link rel="stylesheet" href="theme.css" data-deck-theme>',
    "</head>",
    "<body>",
    ...slides.map((slide) => `  ${slide}`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const slide = (...children: string[]): string => `<section data-slide>${children.map((child) => `\n    ${child}`).join("")}\n  </section>`;
const px = (id: string, extra = ""): string => `<div data-block="${id}"${extra} style="left: 10px; top: 20px; width: 100px; height: 50px;"><p>${id}</p></div>`;
const cellBlock = (id: string, extra = ""): string => `<div data-block="${id}"${extra} class="col-1 row-1 span-2 rows-1"><p>${id}</p></div>`;

const TWO_SLIDES = deckHtml([slide(px("a"), px("b"), px("c")), slide(px("d"), px("e"))]);
const GROUPED = deckHtml([slide(px("a", ' data-group="team"'), px("b", ' data-group="team"'), px("c", ' data-group="other"'), px("loose")), slide(px("d", ' data-group="far"'))]);

function edited(html: string, edit: DeckEdit): string {
  const result = applyDeckEdit(html, edit);
  if (!result.ok) throw new Error(`edit refused: ${result.error}`);
  return result.html;
}

function expectRefused(html: string, edit: DeckEdit): void {
  const result = applyDeckEdit(html, edit);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(typeof result.error).toBe("string");
  expect(result.error.trim().length).toBeGreaterThan(0);
}

function modelOf(html: string): DeckModel {
  const { model } = parseDeck(html);
  if (!model) throw new Error("deck did not parse");
  return model;
}

const groupsOf = (html: string): Record<string, string | undefined> =>
  Object.fromEntries(modelOf(html).slides.flatMap((s) => s.blocks).map((block) => [block.id, block.group]));
const stripGroups = (html: string): string => html.replace(/ data-group="[^"]*"/g, "");
const errorsOf = (html: string) => validateDeck(html, { theme: THEME, files: FILES }).filter((d) => d.severity === "error");

describe("deckGroupMembers", () => {
  it("8.1c lists the blocks of a group in document order", () => {
    const members = deckGroupMembers(modelOf(GROUPED), "team");
    expect(members.map((block) => block.id)).toEqual(["a", "b"]);
  });

  it("8.1c finds a group on another slide", () => {
    expect(deckGroupMembers(modelOf(GROUPED), "far").map((block) => block.id)).toEqual(["d"]);
  });

  it("8.1c gives an empty list for an unknown group", () => {
    expect(deckGroupMembers(modelOf(GROUPED), "nobody")).toEqual([]);
    expect(deckGroupMembers(modelOf(TWO_SLIDES), "team")).toEqual([]);
  });

  it("8.1c gives the parsed blocks", () => {
    const model = modelOf(GROUPED);
    expect(deckGroupMembers(model, "team")[0]).toEqual(model.slides[0]!.blocks[0]);
  });
});

describe("applyDeckEdit group", () => {
  it("8.1c sets data-group on each listed block and nothing else changes", () => {
    const html = edited(TWO_SLIDES, { kind: "group", blocks: ["a", "c"], group: "team" });
    expect(groupsOf(html)).toEqual({ a: "team", b: undefined, c: "team", d: undefined, e: undefined });
    expect(stripGroups(html)).toBe(TWO_SLIDES);
  });

  it("8.1c writes data-group as one attribute per block", () => {
    const html = edited(TWO_SLIDES, { kind: "group", blocks: ["a", "b", "c"], group: "team" });
    expect(html.match(/data-group="team"/g)).toHaveLength(3);
  });

  it("8.1c the order of the listed ids does not matter", () => {
    const forward = edited(TWO_SLIDES, { kind: "group", blocks: ["a", "b"], group: "team" });
    const backward = edited(TWO_SLIDES, { kind: "group", blocks: ["b", "a"], group: "team" });
    expect(backward).toBe(forward);
  });

  it("8.1c replaces an old data-group value", () => {
    const html = edited(GROUPED, { kind: "group", blocks: ["a", "c"], group: "fresh" });
    expect(groupsOf(html)).toMatchObject({ a: "fresh", b: "team", c: "fresh", loose: undefined, d: "far" });
    expect(html.match(/data-group=/g)).toHaveLength(4);
    expect(stripGroups(html)).toBe(stripGroups(GROUPED));
  });

  it("8.1c groups cell blocks too", () => {
    const html = deckHtml([slide(cellBlock("a"), cellBlock("b"))]);
    const result = edited(html, { kind: "group", blocks: ["a", "b"], group: "pair" });
    expect(groupsOf(result)).toEqual({ a: "pair", b: "pair" });
    expect(stripGroups(result)).toBe(html);
  });

  it("8.1c the grouped deck validates", () => {
    expect(errorsOf(edited(TWO_SLIDES, { kind: "group", blocks: ["a", "b"], group: "team-1" }))).toEqual([]);
  });

  it("8.1c accepts a group id of letters, digits and hyphens", () => {
    for (const group of ["g", "group-12", "a1-b2"]) expect(groupsOf(edited(TWO_SLIDES, { kind: "group", blocks: ["a", "b"], group }))["a"]).toBe(group);
  });

  it("8.1c refuses fewer than two blocks", () => {
    expectRefused(TWO_SLIDES, { kind: "group", blocks: ["a"], group: "team" });
    expectRefused(TWO_SLIDES, { kind: "group", blocks: [], group: "team" });
  });

  it("8.1c refuses blocks on different slides", () => {
    expectRefused(TWO_SLIDES, { kind: "group", blocks: ["a", "d"], group: "team" });
  });

  it("8.1c refuses an unknown block", () => {
    expectRefused(TWO_SLIDES, { kind: "group", blocks: ["a", "missing"], group: "team" });
  });

  it.each(["Team", "1team", "-team", "has space", "", "a".repeat(41), "under_score"])("8.1c refuses the group id %p", (group) => {
    expectRefused(TWO_SLIDES, { kind: "group", blocks: ["a", "b"], group });
  });

  it("8.1c refuses a group id that is a block id", () => {
    expectRefused(TWO_SLIDES, { kind: "group", blocks: ["a", "b"], group: "c" });
    expectRefused(TWO_SLIDES, { kind: "group", blocks: ["a", "b"], group: "d" });
  });
});

describe("applyDeckEdit ungroup", () => {
  it("8.1c removes data-group from every block of the group and no other", () => {
    const html = edited(GROUPED, { kind: "ungroup", group: "team" });
    expect(groupsOf(html)).toEqual({ a: undefined, b: undefined, c: "other", loose: undefined, d: "far" });
  });

  it("8.1c removes the attribute with its leading space and keeps every other byte", () => {
    const html = edited(GROUPED, { kind: "ungroup", group: "team" });
    expect(html).toBe(GROUPED.replace(' data-group="team"', "").replace(' data-group="team"', ""));
  });

  it("8.1c ungroup undoes group", () => {
    const grouped = edited(TWO_SLIDES, { kind: "group", blocks: ["a", "b"], group: "team" });
    expect(edited(grouped, { kind: "ungroup", group: "team" })).toBe(TWO_SLIDES);
  });

  it("8.1c finds the group on a later slide", () => {
    const html = edited(GROUPED, { kind: "ungroup", group: "far" });
    expect(groupsOf(html)["d"]).toBeUndefined();
    expect(groupsOf(html)["a"]).toBe("team");
  });

  it("8.1c refuses a group no block carries", () => {
    expectRefused(TWO_SLIDES, { kind: "ungroup", group: "team" });
    expectRefused(GROUPED, { kind: "ungroup", group: "nobody" });
  });

  it("8.1c refuses a second ungroup of the same group", () => {
    expectRefused(edited(GROUPED, { kind: "ungroup", group: "team" }), { kind: "ungroup", group: "team" });
  });
});

describe("groups are flat", () => {
  it("8.1c grouping adds no wrapper element", () => {
    const html = edited(TWO_SLIDES, { kind: "group", blocks: ["a", "b"], group: "team" });
    expect(html.match(/<div/g)).toHaveLength(TWO_SLIDES.match(/<div/g)!.length);
    expect(modelOf(html).slides[0]!.blocks.map((block) => block.id)).toEqual(["a", "b", "c"]);
  });

  it("8.1c a block is in at most one group: regrouping moves it", () => {
    const html = edited(GROUPED, { kind: "group", blocks: ["a", "loose"], group: "second" });
    expect(deckGroupMembers(modelOf(html), "second").map((block) => block.id)).toEqual(["a", "loose"]);
    expect(deckGroupMembers(modelOf(html), "team").map((block) => block.id)).toEqual(["b"]);
    expect(html.match(/<div data-block="a"[^>]*>/)![0].match(/data-group=/g)).toHaveLength(1);
  });
});
