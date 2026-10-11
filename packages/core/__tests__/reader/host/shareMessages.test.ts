import { DEFAULT_READER_PREFS, type CitationStyle } from "@labshelf/core";
import { setupHost, sidecar } from "./hostFixture";

describe("reader share messages", () => {
  it("copies plain text and confirms", async () => {
    const { host, ports } = setupHost();
    await host.handle({ command: "copyText", text: "[1] A. Author. Title." });
    expect(ports.writeClipboard).toHaveBeenCalledWith("[1] A. Author. Title.");
    expect(ports.notify).toHaveBeenCalledWith("Copied to clipboard", "ok");
  });

  it.each<[CitationStyle, string]>([
    ["pandoc", "> A quoted passage.\n\n[@imai1986, p. 12]"],
    ["latex", "``A quoted passage.'' \\cite[p.~12]{imai1986}"],
    ["author-year", '"A quoted passage." (Imai & Asano, 1986, p. 12)'],
    ["citekey", "A quoted passage. @imai1986"],
  ])("copies a selection with a %s citation read from the current prefs", async (style, expected) => {
    const { host, ports, setPrefs } = setupHost();
    setPrefs({ ...DEFAULT_READER_PREFS, citationStyle: style });
    await host.handle({ command: "copyWithCitation", text: "A quoted\npassage.", pageNumber: 12 });
    expect(ports.writeClipboard).toHaveBeenCalledWith(expected);
    expect(ports.notify).toHaveBeenCalledWith("Copied with citation (@imai1986, p. 12)", "ok");
  });

  it("exports annotations to the clipboard or hands them to the host to save", async () => {
    const { host, ports } = setupHost({ seed: sidecar });
    await host.handle({ command: "exportAnnotations", target: "clipboard" });
    expect(ports.writeClipboard.mock.calls[0]![0]).toContain("# Efficient Algorithms");
    await host.handle({ command: "exportAnnotations", target: "file" });
    expect(ports.saveAnnotations).toHaveBeenCalledWith(expect.stringContaining("## Page 1"));
  });

  it("opens only http(s) and mailto links and warns about the rest", async () => {
    const { host, ports } = setupHost();
    for (const url of ["https://doi.org/10.1137/0215022", "mailto:a@b.org"]) {
      await host.handle({ command: "openExternalLink", url });
    }
    for (const url of ["file:///etc/passwd", "command:workbench.action.terminal.new", "vscode://x/y", "javascript:alert(1)", "not a url"]) {
      await host.handle({ command: "openExternalLink", url });
    }
    expect(ports.openExternal.mock.calls.map((c) => c[0])).toEqual(["https://doi.org/10.1137/0215022", "mailto:a@b.org"]);
    expect(ports.logger.log).toHaveBeenCalledTimes(5);
    expect(ports.logger.log).toHaveBeenCalledWith("WARN", "reader", "Blocked external link with disallowed scheme", { paperId: "p1" });
  });
});
