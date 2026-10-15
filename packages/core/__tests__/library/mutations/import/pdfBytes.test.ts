// Contract of the one PDF check every import path shares: the "%PDF-" header is the first five bytes.
import { isPdfBytes } from "@labshelf/core";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("isPdfBytes", () => {
  it("accepts bytes that start with the PDF header", () => {
    expect(isPdfBytes(bytes("%PDF-1.4\n"))).toBe(true);
    expect(isPdfBytes(bytes("%PDF-"))).toBe(true);
  });

  it("rejects anything before the header, a truncated header, HTML and nothing", () => {
    expect(isPdfBytes(bytes("\n\n%PDF-1.4"))).toBe(false);
    expect(isPdfBytes(bytes("%PDF"))).toBe(false);
    expect(isPdfBytes(bytes("<!DOCTYPE html><title>Login</title>"))).toBe(false);
    expect(isPdfBytes(new Uint8Array())).toBe(false);
  });
});
