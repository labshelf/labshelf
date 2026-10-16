/**
 * @jest-environment jsdom
 */
import { mountForTest, paper } from "../mountHarness";

const DAY = 86_400_000;
const daysAgo = (d: number): string => new Date(Date.now() - d * DAY).toISOString();

describe("Last read cell", () => {
  it("shows the compact time, and the full date, time and page as its title", () => {
    const t = mountForTest();
    const lastRead = daysAgo(3);
    t.snapshot([paper("a", "papers")], [], [], { a: { annotations: 0, lastPage: 2, lastRead } });
    const cell = t.container.querySelector<HTMLElement>(".paper-row .col-read")!;
    expect(cell.textContent).toBe("3 d");
    expect(cell.title).toBe(`Last read ${new Date(lastRead).toLocaleString()}, page 2`);
  });

  it("shows a dash and no title for a paper never read", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers")]);
    const cell = t.container.querySelector<HTMLElement>(".paper-row .col-read")!;
    expect(cell.textContent).toBe("—");
    expect(cell.hasAttribute("title")).toBe(false);
  });
});

describe("Status cell", () => {
  const markOf = (status: "unread" | "reading" | "done"): HTMLElement => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { status })]);
    const main = t.container.querySelector<HTMLElement>(".paper-row-main")!;
    expect(main.querySelector("[class*='ls-badge']")).toBeNull();
    return main.querySelector<HTMLElement>(".status-mark [role='img']")!;
  };

  it("draws a dot for an unread paper", () => {
    const mark = markOf("unread");
    expect(mark.classList.contains("ls-status-dot") || mark.querySelector(".ls-status-dot") !== null).toBe(true);
    expect(mark.getAttribute("aria-label")).toBe("Unread");
  });

  it.each([["reading", "Reading"], ["done", "Done"]] as const)("draws an arc mark for a %s paper", (status, label) => {
    const mark = markOf(status);
    expect(mark.querySelector("svg") ?? mark.closest("svg")).not.toBeNull();
    expect(mark.getAttribute("aria-label")).toBe(label);
  });
});
