/** Verifies the in-memory tar.gz reader: names, entry kinds, long names and the limits on hostile archives. */
import { gzipSync } from "node:zlib";
import { readTarGz } from "../../../../src/writing/templates/sources/readTarGz.js";
import { tar, tarGz } from "./tarFixture";

const LIMIT = 1024 * 1024;
const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString();

describe("readTarGz", () => {
  it("reads files and directories, dropping a leading ./ and a trailing /", async () => {
    const entries = await readTarGz(tarGz([
      { name: "./", type: "5" },
      { name: "./template/", type: "5" },
      { name: "./template/main.typ", body: "= Title" },
    ]), LIMIT);
    expect(entries.map((e) => [e.path, e.kind])).toEqual([["", "directory"], ["template", "directory"], ["template/main.typ", "file"]]);
    expect(text(entries[2]!.bytes)).toBe("= Title");
  });

  it("reads a body that spans several blocks and the entry after it", async () => {
    const big = "x".repeat(1300);
    const entries = await readTarGz(tarGz([{ name: "a.txt", body: big }, { name: "b.txt", body: "b" }]), LIMIT);
    expect(entries.map((e) => [e.path, e.bytes.length])).toEqual([["a.txt", 1300], ["b.txt", 1]]);
  });

  it("joins the ustar prefix, a GNU long name and a pax path to the entry they name", async () => {
    const long = `template/${"d/".repeat(60)}main.typ`;
    const entries = await readTarGz(tarGz([
      { name: "main.typ", prefix: "template", body: "p" },
      { name: "././@LongLink", type: "L", body: `${long}\0` },
      { name: "short", body: "l" },
      { name: "PaxHeader", type: "x", body: "30 path=template/pax-name.typ\n" },
      { name: "ignored", body: "x" },
    ]), LIMIT);
    expect(entries.map((e) => e.path)).toEqual(["template/main.typ", long, "template/pax-name.typ"]);
  });

  it("reports hard and symbolic links as links", async () => {
    const entries = await readTarGz(tarGz([{ name: "hard", type: "1" }, { name: "soft", type: "2" }]), LIMIT);
    expect(entries.map((e) => e.kind)).toEqual(["link", "link"]);
  });

  it("refuses an archive that unpacks past the limit", async () => {
    await expect(readTarGz(tarGz([{ name: "big", body: new Uint8Array(4096) }]), 2048)).rejects.toThrow(/more than 2048 bytes/);
  });

  it("refuses an archive cut inside an entry", async () => {
    const whole = tar([{ name: "a.txt", body: "x".repeat(2000) }]);
    await expect(readTarGz(new Uint8Array(gzipSync(whole.subarray(0, 1024))), LIMIT)).rejects.toThrow(/ends inside an entry/);
  });

  it("refuses bytes that are not gzip", async () => {
    await expect(readTarGz(new Uint8Array([1, 2, 3, 4]), LIMIT)).rejects.toThrow();
  });
});
