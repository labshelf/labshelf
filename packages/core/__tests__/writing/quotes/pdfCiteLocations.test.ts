// Tests reading a cite key from a hyperref destination name and from a Typst citation's position.
import { deriveCiteKey, findTypstCitationAt, type TypstCitation } from "../../../src/writing/quotes";

describe("deriveCiteKey", () => {
  it.each([
    ["cite.smith2020", "smith2020"],
    ["cite.0@smith2020", "smith2020"],
    ["cite.12@doe:19", "doe:19"],
    ["cite.van-der-berg.2021", "van-der-berg.2021"],
  ])("reads %s as %s", (dest, key) => {
    expect(deriveCiteKey(dest)).toBe(key);
  });

  it.each(["section.1", "Hfootnote.2", "page.3", "cite.", "citation.smith"])("reads no key from %s", (dest) => {
    expect(deriveCiteKey(dest)).toBeUndefined();
  });
});

describe("findTypstCitationAt", () => {
  const cites: TypstCitation[] = [
    { key: "smith2020", at: { page: 1, x: 56.37, y: 41.31 } },
    { key: "doe19", at: { page: 1, x: 118.14, y: 41.31 } },
    { key: "doe19", at: { page: 2, x: 64.94, y: 41.31 } },
  ];
  const linkAt = (page: number, left: number) => ({ page, left, top: 30.17, right: left + 12.23, bottom: 44.89 });

  it("finds the citation whose text starts inside the link", () => {
    expect(findTypstCitationAt(cites, linkAt(1, 56.3742))).toBe("smith2020");
    expect(findTypstCitationAt(cites, linkAt(1, 118.14178))).toBe("doe19");
    expect(findTypstCitationAt(cites, linkAt(2, 64.93572))).toBe("doe19");
  });

  it("finds nothing on another page or away from every citation", () => {
    expect(findTypstCitationAt(cites, linkAt(3, 56.3742))).toBeUndefined();
    expect(findTypstCitationAt(cites, linkAt(2, 33.74))).toBeUndefined();
    expect(findTypstCitationAt([], linkAt(1, 56.3742))).toBeUndefined();
  });
});
