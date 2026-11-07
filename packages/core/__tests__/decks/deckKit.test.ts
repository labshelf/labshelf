// Tests the Kit file format: the slug rule, the validating parser and the serializer.
import { DECK_STYLE_TOKENS, DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens.js";
import type { DeckStyle } from "../../src/decks/deckStyleTokens.js";
import { DECK_KIT_FOLDER, DECK_KIT_MAX_IMAGE_BYTES, DECK_KIT_VERSION, deckKitSlug, parseDeckKit, serializeDeckKit } from "../../src/decks/deckKit.js";
import type { DeckKit } from "../../src/decks/deckKit.js";

const style: DeckStyle = { ...DEFAULT_DECK_STYLE, primary: "#0b5394", accent: "#b45f06" };
const kit: DeckKit = { name: "Universidade de São Paulo", style, logo: "kits/universidade-de-sao-paulo.png", footer: "IF - USP" };

/** The JSON text of a kit with some fields replaced; `undefined` removes the key. */
function raw(patch: Record<string, unknown>): string {
  const base: Record<string, unknown> = { version: 1, name: "Lab", style: { ...DEFAULT_DECK_STYLE } };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return JSON.stringify(base);
}

describe("4b.1a constants", () => {
  it("4b.1a names the version, the folder and the image limit", () => {
    expect(DECK_KIT_VERSION).toBe(1);
    expect(DECK_KIT_FOLDER).toBe("kits");
    expect(DECK_KIT_MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("4b.1a deckKitSlug", () => {
  it("4b.1a strips accents and punctuation into one dash", () => {
    expect(deckKitSlug("Universidade de São Paulo — IF")).toBe("universidade-de-sao-paulo-if");
  });

  it("4b.1a gives 'kit' for an empty name", () => {
    expect(deckKitSlug("")).toBe("kit");
  });

  it("4b.1a gives 'kit' for a name without letters or digits", () => {
    expect(deckKitSlug("***")).toBe("kit");
  });

  it("4b.1a collapses runs and trims dashes at both ends", () => {
    expect(deckKitSlug("  --My   Lab__2024!! ")).toBe("my-lab-2024");
  });

  it("4b.1a cuts a long name to 60 characters", () => {
    const slug = deckKitSlug("a".repeat(100));
    expect(slug).toBe("a".repeat(60));
  });

  it("4b.1a trims a dash left at the cut", () => {
    const slug = deckKitSlug(`${"a".repeat(59)} ${"b".repeat(20)}`);
    expect(slug).toBe("a".repeat(59));
  });
});

describe("4b.1b serializeDeckKit", () => {
  it("4b.1b writes version, name, style, logo and footer in that order with 2-space indent and a final newline", () => {
    const text = serializeDeckKit(kit);
    expect(text).toBe(`${JSON.stringify({ version: 1, name: kit.name, style, logo: kit.logo, footer: kit.footer }, null, 2)}\n`);
  });

  it("4b.1b omits logo and footer when absent", () => {
    const parsed = JSON.parse(serializeDeckKit({ name: "Lab", style })) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["version", "name", "style"]);
  });

  it("4b.1b writes the style keys in token order", () => {
    const shuffled = Object.fromEntries([...DECK_STYLE_TOKENS].reverse().map((token) => [token, style[token]])) as unknown as DeckStyle;
    const parsed = JSON.parse(serializeDeckKit({ name: "Lab", style: shuffled })) as { style: Record<string, unknown> };
    expect(Object.keys(parsed.style)).toEqual([...DECK_STYLE_TOKENS]);
  });

  it("4b.1b normalises the colours of the style", () => {
    const parsed = JSON.parse(serializeDeckKit({ name: "Lab", style: { ...style, primary: "#ABC" } })) as { style: DeckStyle };
    expect(parsed.style.primary).toBe("#aabbcc");
  });
});

describe("4b.1b parseDeckKit", () => {
  it("4b.1b round-trips a kit with logo and footer exactly", () => {
    expect(parseDeckKit(serializeDeckKit(kit))).toEqual(kit);
  });

  it("4b.1b round-trips a kit without logo and footer", () => {
    const bare: DeckKit = { name: "Lab", style };
    expect(parseDeckKit(serializeDeckKit(bare))).toEqual(bare);
  });

  it("4b.1b returns null for invalid JSON", () => {
    expect(parseDeckKit("{not json")).toBeNull();
    expect(parseDeckKit("")).toBeNull();
  });

  it("4b.1b returns null for a value that is not an object", () => {
    expect(parseDeckKit("[]")).toBeNull();
    expect(parseDeckKit("42")).toBeNull();
    expect(parseDeckKit("null")).toBeNull();
  });

  it("4b.1b returns null for version 2 and for a missing version", () => {
    expect(parseDeckKit(raw({ version: 2 }))).toBeNull();
    expect(parseDeckKit(raw({ version: undefined }))).toBeNull();
  });

  it("4b.1b returns null for an empty or blank name", () => {
    expect(parseDeckKit(raw({ name: "" }))).toBeNull();
    expect(parseDeckKit(raw({ name: "   " }))).toBeNull();
  });

  it("4b.1b returns null for a name that is not a string or is over 80 characters", () => {
    expect(parseDeckKit(raw({ name: 7 }))).toBeNull();
    expect(parseDeckKit(raw({ name: "n".repeat(81) }))).toBeNull();
    expect(parseDeckKit(raw({ name: "n".repeat(80) }))?.name).toBe("n".repeat(80));
  });

  it("4b.1b trims the name", () => {
    expect(parseDeckKit(raw({ name: "  Lab  " }))?.name).toBe("Lab");
  });

  it.each([...DECK_STYLE_TOKENS])("4b.1b returns null when the style token %s is missing", (token) => {
    const partial: Record<string, unknown> = { ...DEFAULT_DECK_STYLE };
    delete partial[token];
    expect(parseDeckKit(raw({ style: partial }))).toBeNull();
  });

  it("4b.1b returns null for a missing style", () => {
    expect(parseDeckKit(raw({ style: undefined }))).toBeNull();
  });

  it("4b.1b returns null for an invalid colour", () => {
    expect(parseDeckKit(raw({ style: { ...DEFAULT_DECK_STYLE, primary: "red" } }))).toBeNull();
  });

  it("4b.1b returns null for an invalid scale", () => {
    expect(parseDeckKit(raw({ style: { ...DEFAULT_DECK_STYLE, scale: 99 } }))).toBeNull();
  });

  it("4b.1b normalises a short colour in the style it returns", () => {
    expect(parseDeckKit(raw({ style: { ...DEFAULT_DECK_STYLE, accent: "#ABC" } }))?.style.accent).toBe("#aabbcc");
  });

  it("4b.1b ignores unknown keys", () => {
    const parsed = parseDeckKit(raw({ extra: { a: 1 } }));
    expect(parsed).toEqual({ name: "Lab", style: DEFAULT_DECK_STYLE });
  });

  it.each(["../x.png", "kits/a/b.png", "kits/x.exe", "kits/a\\b.png", "kits/x.bmp", "logo.png", "kits/noext", 5])("4b.1b drops the logo %p and keeps the kit", (logo) => {
    const parsed = parseDeckKit(raw({ logo }));
    expect(parsed).not.toBeNull();
    expect(parsed?.logo).toBeUndefined();
  });

  it.each(["kits/a.png", "kits/a.jpg", "kits/a.jpeg", "kits/a.svg", "kits/a.webp", "kits/a.gif", "kits/Logo.PNG"])("4b.1b keeps the logo %s", (logo) => {
    expect(parseDeckKit(raw({ logo }))?.logo).toBe(logo);
  });

  it("4b.1b drops a 300-character footer and keeps the kit", () => {
    const parsed = parseDeckKit(raw({ footer: "f".repeat(300) }));
    expect(parsed).not.toBeNull();
    expect(parsed?.footer).toBeUndefined();
  });

  it("4b.1b keeps a footer of 200 characters", () => {
    expect(parseDeckKit(raw({ footer: "f".repeat(200) }))?.footer).toBe("f".repeat(200));
  });

  it("4b.1b trims the footer and drops an empty one", () => {
    expect(parseDeckKit(raw({ footer: "  IF  " }))?.footer).toBe("IF");
    expect(parseDeckKit(raw({ footer: "   " }))?.footer).toBeUndefined();
  });

  it("4b.1b drops a footer that is not a string", () => {
    expect(parseDeckKit(raw({ footer: 3 }))?.footer).toBeUndefined();
  });
});
