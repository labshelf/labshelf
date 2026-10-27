import { formatBytes } from "../../../src/library/record";

describe("formatBytes", () => {
  it("shows plain bytes under 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("rounds to whole kilobytes under 1 MB", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(1023 * 1024)).toBe("1023 KB");
  });

  it("switches to MB with one decimal instead of showing 1024 KB", () => {
    expect(formatBytes(1048575)).toBe("1.0 MB");
    expect(formatBytes(Math.round(2.4 * 1024 * 1024))).toBe("2.4 MB");
    expect(formatBytes(120 * 1024 * 1024)).toBe("120.0 MB");
  });
});
