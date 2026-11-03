/** @jest-environment jsdom */
// Tests the shared place header: tabs with counts, debounced search, the "/" key with teardown, and the New and Empty trash buttons.
import { mountPlaceHeader, type PlaceHeaderHandlers } from "../../../../src/ui/dom/index.js";

type Id = "a" | "b" | "trash";
const counts = (trash = 0): Record<Id, number> => ({ a: 3, b: 1, trash });

function setup() {
  jest.useFakeTimers();
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  const handlers: PlaceHeaderHandlers<Id> = { onPlace: jest.fn(), onQuery: jest.fn(), onNew: jest.fn(), onEmptyTrash: jest.fn(), onLeaveSearch: jest.fn() };
  const header = mountPlaceHeader<Id>(container, {
    places: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "trash", label: "Trash" }],
    ariaLabel: "Things", placeholder: "Search things", inputClass: "my-search", newLabel: "New thing", newTitle: "Make a thing", emptyTrashTitle: "Drop all",
  }, handlers);
  header.paint("a", counts(), "");
  const search = container.querySelector<HTMLInputElement>("input.my-search")!;
  const key = (target: EventTarget, k: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  return { container, handlers, header, search, key };
}
afterEach(() => jest.useRealTimers());

describe("mountPlaceHeader", () => {
  it("renders labelled tabs with counts and marks the current place", () => {
    const { container } = setup();
    expect(container.classList.contains("ls-place-header")).toBe(true);
    expect(container.querySelector(".ls-place-tabs")!.getAttribute("aria-label")).toBe("Things");
    const tabs = [...container.querySelectorAll<HTMLElement>(".ls-place-tab")];
    expect(tabs.map((t) => t.textContent)).toEqual(["Alpha3", "Beta1", "Trash0"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  });

  it("reports a clicked tab and moves between tabs with the arrow keys", () => {
    const { container, handlers, key } = setup();
    container.querySelector<HTMLElement>('[data-place="b"]')!.click();
    expect(handlers.onPlace).toHaveBeenLastCalledWith("b");
    key(container.querySelector('[data-place="trash"]')!, "ArrowRight");
    expect(handlers.onPlace).toHaveBeenLastCalledWith("a");
    key(container.querySelector('[data-place="a"]')!, "ArrowLeft");
    expect(handlers.onPlace).toHaveBeenLastCalledWith("trash");
  });

  it("shows New outside Trash and Empty trash only in Trash, disabled at zero", () => {
    const { container, header } = setup();
    const add = container.querySelector<HTMLButtonElement>('[data-act="new"]')!;
    const empty = container.querySelector<HTMLButtonElement>('[data-act="empty-trash"]')!;
    expect([add.hidden, empty.hidden]).toEqual([false, true]);
    expect(add.textContent).toBe("New thing");
    expect(add.title).toBe("Make a thing");
    expect(empty.title).toBe("Drop all");
    header.paint("trash", counts(0), "");
    expect([add.hidden, empty.hidden, empty.disabled]).toEqual([true, false, true]);
    header.paint("trash", counts(2), "");
    expect(empty.disabled).toBe(false);
  });

  it("passes the New button as anchor and fires empty trash", () => {
    const { container, handlers, header } = setup();
    const add = container.querySelector<HTMLButtonElement>('[data-act="new"]')!;
    add.click();
    expect(handlers.onNew).toHaveBeenCalledWith(add);
    header.paint("trash", counts(2), "");
    container.querySelector<HTMLButtonElement>('[data-act="empty-trash"]')!.click();
    expect(handlers.onEmptyTrash).toHaveBeenCalledTimes(1);
  });

  it("debounces the query, clears it with Esc and the clear button, and shows the query state", () => {
    const { container, handlers, header, search, key } = setup();
    for (const text of ["x", "xy"]) { search.value = text; search.dispatchEvent(new Event("input")); }
    jest.advanceTimersByTime(80);
    expect(handlers.onQuery).toHaveBeenCalledTimes(1);
    expect(handlers.onQuery).toHaveBeenCalledWith("xy");
    header.paint("a", counts(), "xy");
    expect(container.querySelector(".ls-search")!.classList.contains("has-query")).toBe(true);
    container.querySelector<HTMLButtonElement>('[data-act="clear"]')!.click();
    expect(search.value).toBe("");
    expect(handlers.onQuery).toHaveBeenLastCalledWith("");
    search.value = "q"; key(search, "Escape");
    expect(search.value).toBe("");
    expect(handlers.onLeaveSearch).toHaveBeenCalledTimes(1);
    key(search, "ArrowDown");
    expect(handlers.onLeaveSearch).toHaveBeenCalledTimes(2);
  });

  it("focuses the search on '/' outside text fields until it is disposed", () => {
    const { header, search, key } = setup();
    key(document.body, "/");
    expect(document.activeElement).toBe(search);
    search.blur();
    header.dispose();
    key(document.body, "/");
    expect(document.activeElement).not.toBe(search);
  });
});

describe("mountPlaceHeader options", () => {
  function mountWith(extra: Partial<Parameters<typeof mountPlaceHeader<Id>>[1]>, onShare = jest.fn()) {
    document.body.replaceChildren();
    const container = document.createElement("div");
    document.body.append(container);
    const handlers: PlaceHeaderHandlers<Id> = { onPlace: jest.fn(), onQuery: jest.fn(), onNew: jest.fn(), onEmptyTrash: jest.fn(), onLeaveSearch: jest.fn(), onShare };
    const header = mountPlaceHeader<Id>(container, {
      places: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "trash", label: "Trash" }],
      ariaLabel: "Things", placeholder: "Search things", inputClass: "my-search", newLabel: "New thing", newTitle: "Make a thing", emptyTrashTitle: "Drop all",
      ...extra,
    }, handlers);
    header.paint("a", counts(), "");
    return { container, header, handlers };
  }

  it("puts leading nodes first, titles the search box, and can leave out New", () => {
    const toggle = document.createElement("button");
    toggle.className = "lead";
    const { container } = mountWith({ leading: [toggle], searchTitle: "syntax", withNew: false });
    expect(container.firstElementChild).toBe(toggle);
    expect(container.querySelector<HTMLElement>(".ls-search")!.title).toBe("syntax");
    expect(container.querySelector('[data-act="new"]')).toBeNull();
  });

  it("renders a ghost Share button before New, passes it as anchor, and hides it in Trash", () => {
    const onShare = jest.fn();
    const { container, header } = mountWith({ withShare: true }, onShare);
    const share = container.querySelector<HTMLButtonElement>('[data-act="share"]')!;
    expect(share.classList.contains("ls-btn-ghost")).toBe(true);
    expect(share.textContent).toBe("Share");
    expect(share.nextElementSibling).toBe(container.querySelector('[data-act="new"]'));
    share.click();
    expect(onShare).toHaveBeenCalledWith(share);
    header.setShare({ disabled: true, title: "Select one" });
    expect([share.disabled, share.title]).toEqual([true, "Select one"]);
    header.paint("trash", counts(), "");
    expect(share.hidden).toBe(true);
  });

  it("has no Share button unless asked, and passes the key that left the search", () => {
    const { container, handlers } = mountWith({});
    expect(container.querySelector('[data-act="share"]')).toBeNull();
    const search = container.querySelector<HTMLInputElement>("input.my-search")!;
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(handlers.onLeaveSearch).toHaveBeenLastCalledWith("Escape");
  });

  it("leaves the '/' key to the host when slashKey is false", () => {
    const { container } = mountWith({ slashKey: false });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
    expect(document.activeElement).not.toBe(container.querySelector("input.my-search"));
  });
});
