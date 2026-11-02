// Spec 10.3: insertShareQr adds a share-qr image block at the bottom-right corner, findDeckShareLink picks the deck's newest link,
// and Manage Shared Links lists deck entries with kind deck and revokes them.
import { findDeckShareLink, insertShareQr } from "../../src/share/deckQr";
import { applyDeckEdit } from "../../src/decks/deckEdit";
import { validateDeck } from "../../src/decks/deckValidate";
import { encodeQr, formatQrSvg } from "../../src/qr/index";
import { bytesToBase64Url } from "../../src/encoding/index";
import {
  buildShare, createFolderShareLinkOps, deriveShareLinkOfEntry, uploadShare,
  type FolderShareLinkDeps, type ShareEntry,
} from "../../src/share/index";
import { openAnyShare } from "../../src/share/deckShare";
import type { ILogger } from "../../src/ports/index";
import type { RelayAccount } from "../../src/relay/index";
import { memoryShareRegistry, memoryShareRelay } from "../support/memoryShareRelay";

const LINK = "https://share.labshelf.app/s/#relay.someone.workers.dev/0123456789abcdef0123456789abcdef/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function deckHtml(slides: string[], { kind = "talk", size = "1600x1000px" }: { kind?: string; size?: string } = {}): string {
  return [
    "<!doctype html>",
    `<html lang="en" data-deck="${kind}" data-deck-version="1" data-deck-size="${size}">`,
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

const TITLE_BLOCK = '<div data-block="title" style="left: 120px; top: 80px; width: 1200px; height: 200px;"><h1>Title</h1></div>';
const BODY_BLOCK = '<div data-block="body" style="left: 120px; top: 320px; width: 800px; height: 400px;"><p>First &amp; second</p></div>';
const TAKEN_BLOCK = '<div data-block="share-qr" style="left: 10px; top: 10px; width: 100px; height: 100px;"><p>Old</p></div>';
const TAKEN_2_BLOCK = '<div data-block="share-qr-2" style="left: 10px; top: 120px; width: 100px; height: 100px;"><p>Older</p></div>';
const TALK = deckHtml([slide(TITLE_BLOCK), slide(BODY_BLOCK)]);

function qrBlock(id: string, left: number, top: number, side: number): string {
  return `<div data-block="${id}" style="left: ${left}px; top: ${top}px; width: ${side}px; height: ${side}px;"><img src="assets/share-qr.svg" alt="QR code of the share link"></div>`;
}

function expectedHtml(html: string, slideIndex: number, block: string): string {
  const result = applyDeckEdit(html, { kind: "addBlock", slide: slideIndex, html: block });
  if (!result.ok) throw new Error(`fixture edit failed: ${result.error}`);
  return result.html;
}

function inserted(html: string, link: string, slideIndex: number) {
  const result = insertShareQr(html, link, slideIndex);
  if (!result.ok) throw new Error(`insertShareQr failed: ${result.error}`);
  return result.insert;
}

const count = (text: string, part: string): number => text.split(part).length - 1;

describe("insertShareQr", () => {
  it("10.3a adds one share-qr image block of 20% of the shorter side at the bottom-right corner with a 4% margin", () => {
    // 1600x1000: side 200, margin 40, so left 1600-200-40 and top 1000-200-40.
    const insert = inserted(TALK, LINK, 0);
    expect(insert.html).toBe(expectedHtml(TALK, 0, qrBlock("share-qr", 1360, 760, 200)));
    expect(count(insert.html, 'data-block="share-qr"')).toBe(1);
  });

  it("10.3a measures the shorter side of a portrait canvas and inserts into the given slide", () => {
    const portrait = deckHtml([slide(TITLE_BLOCK), slide(BODY_BLOCK)], { size: "1000x1500px" });
    // 1000x1500: shorter side 1000, so side 200, margin 40, left 1000-240, top 1500-240.
    const insert = inserted(portrait, LINK, 1);
    expect(insert.html).toBe(expectedHtml(portrait, 1, qrBlock("share-qr", 760, 1260, 200)));
  });

  it("10.3a rounds the block side to an integer", () => {
    // 1600x1012: 20% of 1012 is 202.4, written as 202px.
    const html = deckHtml([slide(TITLE_BLOCK)], { size: "1600x1012px" });
    const insert = inserted(html, LINK, 0);
    expect(insert.html).toContain("width: 202px; height: 202px;");
  });

  it("10.3a names the svg path and writes the QR of the link with a margin of 4", () => {
    const insert = inserted(TALK, LINK, 0);
    expect(insert.svgPath).toBe("assets/share-qr.svg");
    const matrix = encodeQr(LINK) as Parameters<typeof formatQrSvg>[0];
    expect(insert.svg).toBe(formatQrSvg(matrix, { margin: 4 }));
  });

  it("10.3a renames the block to share-qr-2 when share-qr is taken anywhere in the deck", () => {
    const html = deckHtml([slide(TITLE_BLOCK), slide(BODY_BLOCK, TAKEN_BLOCK)]);
    const insert = inserted(html, LINK, 0);
    expect(insert.html).toBe(expectedHtml(html, 0, qrBlock("share-qr-2", 1360, 760, 200)));
  });

  it("10.3a renames the block to share-qr-3 when share-qr and share-qr-2 are taken", () => {
    const html = deckHtml([slide(TITLE_BLOCK, TAKEN_BLOCK, TAKEN_2_BLOCK)]);
    const insert = inserted(html, LINK, 0);
    expect(insert.html).toBe(expectedHtml(html, 0, qrBlock("share-qr-3", 1360, 760, 200)));
  });

  it("10.3a keeps every byte outside the inserted block", () => {
    const insert = inserted(TALK, LINK, 0);
    const block = qrBlock("share-qr", 1360, 760, 200);
    const at = insert.html.indexOf(block);
    expect(at).toBeGreaterThan(-1);
    const without = insert.html.slice(0, at) + insert.html.slice(at + block.length);
    // Only the block and the line break and indentation the addBlock edit puts around it are new.
    expect(without.replace(/\n[ \t]*(?=\n)/g, "")).toBe(TALK.replace(/\n[ \t]*(?=\n)/g, ""));
  });

  it("10.3a gives a deck that validates with no error and no block outside the canvas", () => {
    const insert = inserted(TALK, LINK, 0);
    const diagnostics = validateDeck(insert.html, { files: new Set(["theme.css", insert.svgPath]) });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.map((d) => d.code)).not.toContain("DECK012");
    expect(diagnostics.map((d) => d.code)).not.toContain("DECK016");
  });

  it("10.3a refuses a link the QR encoder cannot hold", () => {
    const result = insertShareQr(TALK, `https://share.labshelf.app/s/#${"x".repeat(2000)}`, 0);
    expect(result.ok).toBe(false);
    expect(!result.ok && typeof result.error).toBe("string");
  });

  it("10.3a refuses a slide the deck does not have", () => {
    const result = insertShareQr(TALK, LINK, 5);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.length).toBeGreaterThan(0);
  });
});

// Registry entries as the share list stores them; kind is the optional "deck" of D12.
function entry(n: number, folder: string, createdAt: string, kind?: "deck"): ShareEntry {
  const base = {
    id: n.toString(16).padStart(32, "0"),
    folder,
    relayUrl: "https://relay.someone.workers.dev",
    key: bytesToBase64Url(new Uint8Array(32).fill(n)),
    createdAt,
    blobs: [] as string[],
  };
  const withKind: ShareEntry & { kind?: "deck" } = kind ? { ...base, kind } : base;
  return withKind;
}

describe("findDeckShareLink", () => {
  it("10.3d picks the newest deck entry whose folder is the deck title", () => {
    const older = entry(1, "My talk", "2026-01-01T00:00:00.000Z", "deck");
    const newest = entry(2, "My talk", "2026-03-01T00:00:00.000Z", "deck");
    const middle = entry(3, "My talk", "2026-02-01T00:00:00.000Z", "deck");
    expect(findDeckShareLink([older, newest, middle], "My talk")).toBe(deriveShareLinkOfEntry(newest));
  });

  it("10.3d ignores paper entries and other titles", () => {
    const deck = entry(1, "My talk", "2026-01-01T00:00:00.000Z", "deck");
    const paper = entry(2, "My talk", "2026-05-01T00:00:00.000Z");
    const other = entry(3, "Other talk", "2026-06-01T00:00:00.000Z", "deck");
    expect(findDeckShareLink([paper, deck, other], "My talk")).toBe(deriveShareLinkOfEntry(deck));
  });

  it("10.3c gives no link when the deck was not shared, so Insert QR asks to share first", () => {
    const paper = entry(2, "My talk", "2026-05-01T00:00:00.000Z");
    const other = entry(3, "Other talk", "2026-06-01T00:00:00.000Z", "deck");
    expect(findDeckShareLink([paper, other], "My talk")).toBeUndefined();
    expect(findDeckShareLink([], "My talk")).toBeUndefined();
  });
});

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
const RELAY_URL = "https://relay.someone.workers.dev";
const account = { relayUrl: RELAY_URL } as RelayAccount;

/** Two listed shares on a memory relay: a paper folder and one entry the registry marks as a deck. */
async function listedShares() {
  const relay = memoryShareRelay();
  const registry = memoryShareRegistry();
  const upload = async (folderName: string, at: string) => {
    const share = await buildShare({ folderName, papers: [], withAnnotations: false });
    const link = await uploadShare({ share, relayUrl: RELAY_URL, backend: relay.backend, registry, logger, now: () => new Date(at) });
    return { id: share.shareId, link };
  };
  const paper = await upload("Group", "2026-01-01T00:00:00.000Z");
  const deck = await upload("My talk", "2026-02-01T00:00:00.000Z");
  const parsed = JSON.parse(registry.text!) as { shares: Array<Record<string, unknown>> };
  for (const listed of parsed.shares) { if (listed["id"] === deck.id) listed["kind"] = "deck"; }
  registry.text = `${JSON.stringify(parsed, null, 2)}\n`;
  const deps = {
    papers: () => [], papersRoot: "/lib/papers", sep: "/",
    sources: {} as FolderShareLinkDeps["sources"],
    registry,
    relay: { require: async () => account, connected: async () => account },
    backendFor: () => () => relay.backend,
    readerFor: () => relay.reader,
    importLink: async () => ({ status: "refused", error: "bad" }),
    refresh: async () => undefined,
    openFolder: async () => undefined,
  } as FolderShareLinkDeps;
  return { ops: createFolderShareLinkOps(deps, logger), relay, registry, paper, deck };
}

describe("Manage Shared Links with deck entries", () => {
  it("10.3d sharedLinks gives kind deck for a deck entry and no kind for a paper entry", async () => {
    const { ops, paper, deck } = await listedShares();
    const links = await ops.sharedLinks();
    const deckView = links.find((view) => view.id === deck.id);
    const paperView = links.find((view) => view.id === paper.id);
    expect(deckView).toMatchObject({ folder: "My talk", link: deck.link, kind: "deck" });
    expect(paperView).toBeDefined();
    expect(paperView).not.toHaveProperty("kind");
  });

  it("10.3d revoking a deck link removes it from the list and openAnyShare reports removed", async () => {
    const { ops, relay, deck, paper } = await listedShares();
    expect(await ops.revokeLink(deck.id)).toBe(true);
    expect((await ops.sharedLinks()).map((view) => view.id)).toEqual([paper.id]);
    const opened = await openAnyShare(deck.link, () => relay.reader);
    expect(opened).toMatchObject({ ok: false, error: "removed" });
  });

  it("A8 a paper link still opens through openAnyShare after a deck link is revoked", async () => {
    const { ops, relay, deck, paper } = await listedShares();
    await ops.revokeLink(deck.id);
    const opened = await openAnyShare(paper.link, () => relay.reader);
    expect(opened.ok).toBe(true);
  });
});
