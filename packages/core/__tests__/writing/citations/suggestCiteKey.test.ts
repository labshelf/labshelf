/** Verifies which shelf cite key is suggested for an undefined key. */
import { suggestKey } from "../../../src/writing/citations/index";

const shelf = [
  { key: "vaswani2017attention", authors: ["Ashish Vaswani", "Noam Shazeer"], year: "2017" },
  { key: "devlin2019bert", authors: ["Jacob Devlin"], year: "2019" },
  { key: "he2016deep", authors: ["Kaiming He"], year: "2016" },
];

describe("suggestKey", () => {
  it.each([
    ["a typo in the surname", "vaswni2017attention", "vaswani2017attention"],
    ["a typo in the word", "devlin2019brt", "devlin2019bert"],
    ["a wrong year", "vaswani2018attention", "vaswani2017attention"],
    ["a different case", "Devlin2019BERT", "devlin2019bert"],
  ])("suggests the shelf key for %s", (_case, missing, expected) => {
    expect(suggestKey(missing, shelf)).toBe(expected);
  });

  it.each([
    ["a different author with the same year and word", "hinton2017attention"],
    ["an unrelated key", "smith2020graphs"],
    ["an empty key", ""],
  ])("suggests nothing for %s", (_case, missing) => {
    expect(suggestKey(missing, shelf)).toBeUndefined();
  });

  it("suggests nothing on an empty shelf", () => {
    expect(suggestKey("vaswani2017attention", [])).toBeUndefined();
  });

  it("prefers the key whose year matches the missing key", () => {
    const keys = [
      { key: "lecun1998gradient", authors: ["Yann LeCun"], year: "1998" },
      { key: "lecun1989gradient", authors: ["Yann LeCun"], year: "1989" },
    ];
    expect(suggestKey("lecun1989gradiet", keys)).toBe("lecun1989gradient");
  });

  it("breaks a tie by key ascending, whatever the shelf order", () => {
    const keys = [
      { key: "smith2020graphb", authors: ["Jane Smith"], year: "2020" },
      { key: "smith2020grapha", authors: ["Jane Smith"], year: "2020" },
    ];
    expect(suggestKey("smith2020graph", keys)).toBe("smith2020grapha");
    expect(suggestKey("smith2020graph", [...keys].reverse())).toBe("smith2020grapha");
  });

  it("matches a key that does not start with its first author's surname", () => {
    const keys = [{ key: "attention2017", authors: ["Ashish Vaswani"], year: "2017" }];
    expect(suggestKey("attenton2017", keys)).toBe("attention2017");
    expect(suggestKey("vaswani2017", keys)).toBeUndefined();
  });
});
