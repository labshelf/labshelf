import { compactTime } from "../../../src/library/paper/index.js";

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;
const now = Date.UTC(2026, 5, 15, 12, 0, 0);
const ago = (ms: number): string => compactTime(now - ms, now);

describe("compactTime", () => {
  it("says now for under a minute and for a future time", () => {
    expect(ago(0)).toBe("now");
    expect(ago(59 * S)).toBe("now");
    expect(compactTime(now + 5 * MIN, now)).toBe("now");
  });

  it("counts minutes from 1 to 59", () => {
    expect(ago(MIN)).toBe("1 min");
    expect(ago(5 * MIN + 30 * S)).toBe("5 min");
    expect(ago(59 * MIN + 59 * S)).toBe("59 min");
  });

  it("counts hours from 1 to 23", () => {
    expect(ago(H)).toBe("1 h");
    expect(ago(23 * H + 59 * MIN)).toBe("23 h");
  });

  it("counts days from 1 to 6", () => {
    expect(ago(D)).toBe("1 d");
    expect(ago(6 * D + 23 * H)).toBe("6 d");
  });

  it("counts weeks from 1 to 4", () => {
    expect(ago(7 * D)).toBe("1 w");
    expect(ago(13 * D)).toBe("1 w");
    expect(ago(14 * D)).toBe("2 w");
    expect(ago(29 * D)).toBe("4 w");
  });

  it("counts months of 30 days up to 12", () => {
    expect(ago(30 * D)).toBe("1 mo");
    expect(ago(59 * D)).toBe("1 mo");
    expect(ago(60 * D)).toBe("2 mo");
    expect(ago(364 * D)).toBe("12 mo");
  });

  it("counts years from 365 days", () => {
    expect(ago(365 * D)).toBe("1 y");
    expect(ago(729 * D)).toBe("1 y");
    expect(ago(730 * D)).toBe("2 y");
  });
});
