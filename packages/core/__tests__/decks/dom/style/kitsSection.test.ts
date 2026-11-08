/** @jest-environment jsdom */
/** Spec 4b.2: the Style panel's Kits section over a fake kits port: the list, Use, From logo… with faked raster deps, and Save as Kit. */
import type { DeckKit, DeckKitImage, DeckKitsPort } from "../../../../src/decks/deckKit";
import { DEFAULT_DECK_STYLE, DECK_STYLE_TOKENS, validateDeckStyle, type DeckStyle } from "../../../../src/decks/deckStyleTokens";
import type { KitImageDeps } from "../../../../src/decks/dom/style/kitImage";
import { mountStylePanel } from "../../../../src/decks/dom/style/panel";
import type { DeckStylePort } from "../../../../src/decks/dom/style/types";
import { watchStyleMarkup } from "../styleMarkupWatch";

const blockOf = (style: DeckStyle): string => DECK_STYLE_TOKENS.map((token) => `--${token}: ${style[token]};`).join("\n");

interface Fake extends DeckStylePort { applied: DeckStyle[]; current: DeckStyle }
function fakePort(): Fake {
  const port: Fake = {
    current: DEFAULT_DECK_STYLE, applied: [],
    read: () => ({ style: port.current, block: blockOf(port.current) }),
    candidateBlock: (style) => (validateDeckStyle(style).length > 0 ? null : blockOf(style)),
    preview: (style) => Promise.resolve({ kind: "image", src: `data:image/png,${style.primary}` }),
    apply(style) { port.applied.push(style); port.current = style; return true; },
  };
  return port;
}

const KIT_A: DeckKit = { name: "Lab", style: { ...DEFAULT_DECK_STYLE, primary: "#2d6a4f", accent: "#a4161a" }, footer: "The Lab" };
const KIT_B: DeckKit = { name: "Talks", style: { ...DEFAULT_DECK_STYLE, primary: "#6b21a8" } };

interface FakeKits extends DeckKitsPort { kits: DeckKit[]; saved: Array<{ kit: DeckKit; logo?: DeckKitImage }>; lists: number }
function fakeKits(kits: DeckKit[], pick: () => Promise<DeckKitImage | null> = () => Promise.resolve(null)): FakeKits {
  const port: FakeKits = {
    kits: [...kits], saved: [], lists: 0,
    list: () => { port.lists += 1; return Promise.resolve([...port.kits]); },
    save(kit, logo) {
      port.saved.push(logo ? { kit, logo } : { kit });
      if (kit.name === "Bad") return Promise.reject(new Error("The Kit could not be stored."));
      port.kits.push(kit);
      return Promise.resolve(kit);
    },
    pickImage: jest.fn(pick),
  };
  return port;
}

/** A 2x1 "image": 3 blue pixels for every orange one, drawn by a fake canvas. */
function blueOrangeDeps(): KitImageDeps {
  const pixels: number[] = [];
  for (let i = 0; i < 48; i += 1) pixels.push(...(i % 4 === 3 ? [230, 145, 56, 255] : [11, 83, 148, 255]));
  return {
    createCanvas: (width, height) => ({ width, height, getContext: () => ({ drawImage: () => undefined, getImageData: () => ({ data: Uint8ClampedArray.from(pixels) }) }) }) as unknown as HTMLCanvasElement,
    loadImage: () => Promise.resolve({ image: {} as CanvasImageSource, width: 8, height: 6 }),
  };
}

let panel: ReturnType<typeof mountStylePanel> | undefined;
afterEach(() => { panel?.destroy(); panel = undefined; document.body.innerHTML = ""; });

function mount(port: DeckStylePort, kits?: DeckKitsPort, kitImage?: KitImageDeps): HTMLElement {
  panel = mountStylePanel(port, { onClose: () => undefined, ...(kits ? { kits } : {}), ...(kitImage ? { kitImage } : {}) });
  document.body.append(panel.element);
  return panel.element;
}
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const cards = (el: HTMLElement): HTMLButtonElement[] => Array.from(el.querySelectorAll<HTMLButtonElement>(".dsh-style-card"));
const chosenName = (el: HTMLElement): string | undefined => cards(el).find((card) => card.getAttribute("aria-pressed") === "true")?.querySelector(".dsh-style-card-name")?.textContent ?? undefined;
const byLabel = <T extends HTMLElement = HTMLButtonElement>(el: HTMLElement, label: string): T => {
  const found = el.querySelector<T>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no control labelled ${label}`);
  return found;
};
const button = (el: HTMLElement, text: string): HTMLButtonElement => {
  const found = Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};
const status = (el: HTMLElement): string => el.querySelector('[role="status"]')?.textContent ?? "";
const kitRows = (el: HTMLElement): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(".dsh-kit-row"));
function type(input: HTMLInputElement, value: string): void { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }

describe("Kits section list and Use (4b.2a)", () => {
  it("4b.2a without a kits port there is no Kits section", () => {
    const el = mount(fakePort());
    expect(el.querySelector(".dsh-kits")).toBeNull();
    expect(el.textContent).not.toContain("Kits");
  });

  it("4b.2a lists two kits with five swatches each, between More and the token fields", async () => {
    const watch = watchStyleMarkup();
    try {
      const el = mount(fakePort(), fakeKits([KIT_A, KIT_B]));
      await flush();
      const section = el.querySelector<HTMLElement>(".dsh-kits")!;
      expect(section.textContent).toContain("Kits");
      expect(kitRows(el)).toHaveLength(2);
      expect(kitRows(el)[0]!.textContent).toContain("Lab");
      expect(kitRows(el)[0]!.querySelectorAll(".dsh-kit-swatch")).toHaveLength(5);
      expect(byLabel(el, "Use Talks")).toBeTruthy();
      const order = Array.from(el.children);
      expect(order.indexOf(section)).toBe(order.indexOf(el.querySelector(".dsh-style-more")!) + 1);
      expect(order.indexOf(section)).toBeLessThan(order.indexOf(el.querySelector(".dsh-style-fields")!));
      expect(watch.writes).toEqual([]);
    } finally { watch.restore(); }
  });

  it("4b.2a Use makes the kit the chosen card, the diff shows it, Apply writes it once", async () => {
    const port = fakePort();
    const el = mount(port, fakeKits([KIT_A, KIT_B]));
    await flush();
    byLabel(el, "Use Lab").click();
    expect(cards(el)).toHaveLength(5);
    expect(chosenName(el)).toBe("Lab");
    expect(Array.from(el.querySelectorAll(".ls-history-line-added")).some((line) => line.textContent!.includes("#2d6a4f"))).toBe(true);
    byLabel(el, "Use Lab").click();
    expect(cards(el)).toHaveLength(5);
    expect(port.applied).toEqual([]);
    button(el, "Apply").click();
    expect(port.applied).toEqual([KIT_A.style]);
  });

  it("4b.2a an empty list says so, a failing list says it could not be read", async () => {
    const el = mount(fakePort(), fakeKits([]));
    await flush();
    expect(el.querySelector(".dsh-kits")!.textContent).toContain("No kits yet.");
    panel!.destroy();
    const failing = { ...fakeKits([]), list: () => Promise.reject(new Error("io")) };
    const el2 = mount(fakePort(), failing);
    await flush();
    expect(el2.querySelector(".dsh-kits")!.textContent).toContain("Kits could not be read.");
  });
});

describe("From logo… (4b.2b)", () => {
  const LOGO: DeckKitImage = { name: "logo.png", bytes: Uint8Array.from([1, 2, 3]) };

  it("4b.2b picks synchronously and adds a chosen 'From logo.png' card with the image's blue as primary", async () => {
    const kits = fakeKits([], () => Promise.resolve(LOGO));
    const el = mount(fakePort(), kits, blueOrangeDeps());
    await flush();
    button(el, "From logo…").click();
    expect(kits.pickImage).toHaveBeenCalledTimes(1);
    await flush();
    expect(chosenName(el)).toBe("From logo.png");
    expect(byLabel<HTMLInputElement>(el, "Primary hex").value).toBe("#0b5394");
  });

  it("4b.2b a cancelled pick does nothing; a rejected pick or a bad image shows the message", async () => {
    const kits = fakeKits([]);
    const el = mount(fakePort(), kits, blueOrangeDeps());
    await flush();
    button(el, "From logo…").click();
    await flush();
    expect(cards(el)).toHaveLength(4);
    kits.pickImage = jest.fn(() => Promise.reject(new Error("The image is larger than 5 MB.")));
    button(el, "From logo…").click();
    await flush();
    expect(status(el)).toBe("The image is larger than 5 MB.");
    kits.pickImage = jest.fn(() => Promise.resolve(LOGO));
    panel!.destroy();
    const failing: KitImageDeps = { ...blueOrangeDeps(), loadImage: () => Promise.reject(new Error("decode")) };
    const el2 = mount(fakePort(), kits, failing);
    await flush();
    button(el2, "From logo…").click();
    await flush();
    expect(status(el2)).toBe("This image could not be read.");
    expect(cards(el2)).toHaveLength(4);
  });
});

describe("Save as Kit (4b.2c)", () => {
  it("4b.2c sends name, style and footer with the logo of a logo card, reloads the list and says Saved", async () => {
    const logo: DeckKitImage = { name: "logo.png", bytes: Uint8Array.from([9]) };
    const kits = fakeKits([KIT_B], () => Promise.resolve(logo));
    const el = mount(fakePort(), kits, blueOrangeDeps());
    await flush();
    button(el, "From logo…").click();
    await flush();
    button(el, "Save as Kit").click();
    const name = byLabel<HTMLInputElement>(el, "Kit name");
    const save = button(el, "Save");
    expect(name.value).toBe("");
    expect(save.disabled).toBe(true);
    type(name, "  ");
    expect(save.disabled).toBe(true);
    type(name, "Brand");
    type(byLabel<HTMLInputElement>(el, "Kit footer"), "Brand Inc.");
    expect(save.disabled).toBe(false);
    const listsBefore = kits.lists;
    save.click();
    await flush();
    expect(kits.saved).toHaveLength(1);
    expect(kits.saved[0]!.kit.name).toBe("Brand");
    expect(kits.saved[0]!.kit.footer).toBe("Brand Inc.");
    expect(kits.saved[0]!.kit.style.primary).toBe("#0b5394");
    expect(kits.saved[0]!.logo).toBe(logo);
    expect(status(el)).toBe("Saved Brand.");
    expect(kits.lists).toBe(listsBefore + 1);
    expect(kitRows(el)).toHaveLength(2);
    expect(el.querySelector('[aria-label="Kit name"]')).toBeNull();
  });

  it("4b.2c prefills a kit card's name, sends no logo or empty footer, shows a rejection and Cancel closes the form", async () => {
    const kits = fakeKits([KIT_A]);
    const el = mount(fakePort(), kits);
    await flush();
    byLabel(el, "Use Lab").click();
    button(el, "Save as Kit").click();
    const name = byLabel<HTMLInputElement>(el, "Kit name");
    expect(name.value).toBe("Lab");
    button(el, "Save").click();
    await flush();
    expect(kits.saved[0]).toEqual({ kit: { name: "Lab", style: KIT_A.style } });
    button(el, "Save as Kit").click();
    type(byLabel<HTMLInputElement>(el, "Kit name"), "Bad");
    button(el, "Save").click();
    await flush();
    expect(status(el)).toBe("The Kit could not be stored.");
    expect(el.querySelector('[aria-label="Kit name"]')).not.toBeNull();
    button(el, "Cancel").click();
    expect(el.querySelector('[aria-label="Kit name"]')).toBeNull();
  });

  it("4b.2c Save is disabled while the chosen style is invalid", async () => {
    const el = mount(fakePort(), fakeKits([]));
    await flush();
    button(el, "Save as Kit").click();
    type(byLabel<HTMLInputElement>(el, "Kit name"), "Mine");
    expect(button(el, "Save").disabled).toBe(false);
    const hex = byLabel<HTMLInputElement>(el, "Primary hex");
    hex.value = "nope";
    hex.dispatchEvent(new Event("change", { bubbles: true }));
    expect(button(el, "Save").disabled).toBe(true);
  });
});
