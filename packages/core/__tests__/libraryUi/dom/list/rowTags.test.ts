/**
 * @jest-environment jsdom
 */
import { mountForTest, paper } from "../mountHarness";

const library = [
  paper("a", "papers", { title: "Alpha", tags: ["ai", "deep learning"] }),
  paper("b", "papers", { title: "Beta" }),
];

describe("row tags", () => {
  it("renders a button per tag after the title, and none for an untagged paper", () => {
    const t = mountForTest();
    t.snapshot(library);
    const [a, b] = t.rows();
    expect([...a!.querySelectorAll<HTMLElement>(".title-cell .row-tag")].map((e) => [e.dataset["tag"], e.textContent])).toEqual([
      ["ai", "#ai"], ["deep learning", "#deep learning"],
    ]);
    expect(b!.querySelector(".row-tag")).toBeNull();
  });

  it("searches the exact tag on click without selecting or opening the row", () => {
    const t = mountForTest();
    t.snapshot(library);
    const before = t.lib.store.get();
    t.rows()[0]!.querySelectorAll<HTMLElement>(".row-tag")[1]!.click();
    const s = t.lib.store.get();
    expect(s.query).toBe('tag:"deep learning"');
    expect(s.selected).toEqual(before.selected);
    expect(s.open).toBe(before.open);
  });

  it("re-renders the tags when a paper's tags change", () => {
    const t = mountForTest();
    t.snapshot(library);
    t.snapshot([{ ...library[0]!, tags: ["nlp"] }, library[1]!]);
    expect([...t.rows()[0]!.querySelectorAll<HTMLElement>(".row-tag")].map((e) => e.dataset["tag"])).toEqual(["nlp"]);
  });
});
