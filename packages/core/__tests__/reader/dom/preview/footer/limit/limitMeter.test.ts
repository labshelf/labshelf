/**
 * @jest-environment jsdom
 */
// Tests the footer limit meter: thresholds, the single bodyPages report per PDF and the limits popover's posts.
import { mountLimitMeter } from "../../../../../../src/reader/dom/preview/footer/limit/index";
import type { PreviewRoots } from "../../../../../../src/reader/previewProtocol";

function roots(extra: Partial<PreviewRoots> = {}, words?: number): PreviewRoots {
  const root = { path: "/p/main.tex", failed: false, rawLog: true, sourceLinks: true, problems: [], ...(words === undefined ? {} : { words }) };
  return { main: "/p/main.tex", focused: "/p/main.tex", shown: "/p/main.tex", roots: [root], ...extra };
}

function setup(pages = 5) {
  document.body.innerHTML = `<span id="slot" hidden></span>`;
  const slot = document.getElementById("slot")!;
  const post = jest.fn();
  const countBodyPages = jest.fn(async () => pages);
  const meter = mountLimitMeter(slot, { post, countBodyPages });
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const button = () => slot.querySelector<HTMLButtonElement>(".rd-limit")!;
  const fill = () => slot.querySelector<HTMLElement>(".rd-limit-meter i")!;
  const posts = (command: string) => post.mock.calls.map(([m]) => m).filter((m) => m.command === command);
  return { slot, post, countBodyPages, meter, flush, button, fill, posts };
}

describe("limit meter", () => {
  it("shows pages against the page limit", async () => {
    const { slot, meter, flush, button } = setup(5);
    meter.setRoots(roots({ pageLimit: 6 }));
    await flush();
    expect(slot.hidden).toBe(false);
    expect(button().textContent).toContain("p. 5 / 6");
  });

  it.each([
    [8, 10, ""],
    [9, 10, "near"],
    [10, 10, "near"],
    [11, 10, "over"],
  ])("fills the meter at %i of %i with state %p", async (pages, limit, state) => {
    const { meter, flush, fill } = setup(pages);
    meter.setRoots(roots({ pageLimit: limit }));
    await flush();
    expect(fill().className).toBe(state);
    expect(fill().style.width).toBe(`${Math.min(100, (pages / limit) * 100)}%`);
  });

  it("shows words against the word limit and takes the worse ratio for the meter", async () => {
    const { meter, flush, button, fill } = setup(2);
    meter.setRoots(roots({ pageLimit: 10, wordLimit: 1000 }, 1200));
    await flush();
    expect(button().textContent).toContain("1200 words / 1000");
    expect(fill().className).toBe("over");
  });

  it("shows words without a page limit and counts no pages", async () => {
    const { meter, flush, button, countBodyPages } = setup();
    meter.setRoots(roots({ wordLimit: 1000 }, 950));
    await flush();
    expect(button().textContent).toContain("950 words / 1000");
    expect(button().textContent).not.toContain("p.");
    expect(countBodyPages).not.toHaveBeenCalled();
  });

  it("offers the popover with no limits set", () => {
    const { slot, meter, button } = setup();
    meter.setRoots(roots());
    expect(slot.hidden).toBe(false);
    expect(button().textContent).toBe("Limits");
  });

  it("reports body pages once per PDF and again after a document change", async () => {
    const { meter, flush, posts, countBodyPages } = setup(5);
    meter.setRoots(roots({ pageLimit: 6 }));
    await flush();
    meter.setRoots(roots({ pageLimit: 7 }));
    await flush();
    expect(posts("bodyPages")).toEqual([{ command: "bodyPages", root: "/p/main.tex", contentPages: 5 }]);
    meter.documentChanged();
    await flush();
    expect(posts("bodyPages")).toHaveLength(2);
    expect(countBodyPages).toHaveBeenCalledTimes(2);
  });
});

describe("limit popover", () => {
  const open = async (r: PreviewRoots) => {
    const s = setup();
    s.meter.setRoots(r);
    await s.flush();
    s.button().click();
    const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const commit = (el: HTMLInputElement, value: string) => {
      el.value = value;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    };
    return { ...s, input, commit };
  };

  it("posts only the changed field", async () => {
    const { input, commit, posts } = await open(roots({ pageLimit: 6, wordLimit: 1000 }));
    commit(input("Page limit"), "8");
    expect(posts("setCheckLimits")).toEqual([{ command: "setCheckLimits", limits: { pages: 8 } }]);
  });

  it("posts null when a limit is emptied", async () => {
    const { input, commit, posts } = await open(roots({ pageLimit: 6 }));
    commit(input("Page limit"), "  ");
    expect(posts("setCheckLimits")).toEqual([{ command: "setCheckLimits", limits: { pages: null } }]);
  });

  it("posts a limit set on blur once, and nothing when unchanged", async () => {
    const { input, posts } = await open(roots({ wordLimit: 1000 }));
    const words = input("Word limit");
    words.dispatchEvent(new Event("blur"));
    expect(posts("setCheckLimits")).toHaveLength(0);
    words.value = "1500";
    words.dispatchEvent(new Event("blur"));
    words.dispatchEvent(new Event("blur"));
    expect(posts("setCheckLimits")).toEqual([{ command: "setCheckLimits", limits: { words: 1500 } }]);
  });

  it.each(["0", "-3", "1.5", "abc"])("rejects %p and posts nothing", async (value) => {
    const { input, commit, posts } = await open(roots({ pageLimit: 6 }));
    commit(input("Page limit"), value);
    expect(posts("setCheckLimits")).toHaveLength(0);
    expect(input("Page limit").getAttribute("aria-invalid")).toBe("true");
  });

  it("switches where counting stops with a segmented control", async () => {
    const { posts } = await open(roots({ pageLimit: 6 }));
    const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([["References", "true"], ["End", "false"]]);
    radios[1]!.click();
    expect(posts("setCheckLimits")).toEqual([{ command: "setCheckLimits", limits: { countUpTo: "end" } }]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    radios[1]!.click();
    expect(posts("setCheckLimits")).toHaveLength(1);
  });

  it("closes on Escape and returns focus to the meter", async () => {
    const { input, button } = await open(roots({ pageLimit: 6 }));
    input("Page limit").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".rd-popover")).toBeNull();
    expect(document.activeElement).toBe(button());
  });
});
