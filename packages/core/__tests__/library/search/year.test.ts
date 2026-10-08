import { parseQuery } from "@labshelf/core";

describe("year operator", () => {
  it("exact year sets both bounds", () => {
    const q = parseQuery("year:2017");
    expect([q.yearMin, q.yearMax]).toEqual([2017, 2017]);
  });

  it("range sets both bounds", () => {
    const q = parseQuery("year:2015..2020");
    expect([q.yearMin, q.yearMax]).toEqual([2015, 2020]);
  });

  it("open-ended ranges set one bound", () => {
    expect(parseQuery("year:2015..")).toMatchObject({ yearMin: 2015 });
    expect(parseQuery("year:2015..").yearMax).toBeUndefined();
    expect(parseQuery("year:..2020")).toMatchObject({ yearMax: 2020 });
    expect(parseQuery("year:..2020").yearMin).toBeUndefined();
  });

  it("> and < are exclusive", () => {
    expect(parseQuery("year:>2018").yearMin).toBe(2019);
    expect(parseQuery("year:<2000").yearMax).toBe(1999);
  });

  it(">= and <= are inclusive", () => {
    expect(parseQuery("year:>=2018").yearMin).toBe(2018);
    expect(parseQuery("year:<=2000").yearMax).toBe(2000);
  });

  it("accepts the y: shorthand", () => {
    expect(parseQuery("y:2020")).toMatchObject({ yearMin: 2020, yearMax: 2020 });
  });

  it("combines a lower and an upper comparison", () => {
    const q = parseQuery("year:>=2010 year:<2020");
    expect([q.yearMin, q.yearMax]).toEqual([2010, 2019]);
  });

  it("keeps an unparseable year as a plain term", () => {
    for (const bad of ["year:abc", "year:99", "year:20177"]) {
      const q = parseQuery(bad);
      expect(q.yearMin).toBeUndefined();
      expect(q.terms).toEqual([bad]);
    }
  });
});
