// Pins how Tinymist's stderr becomes located problems: paths relative to the working copy and a fallback that keeps the text.
import { parseTinymistDiagnostics } from "../../../../../src/writing/helper/node/build/tinymistDiagnostics";

const SOURCE = "/data/projects/cv/src";

test("one error becomes one problem with its file and line", () => {
  const stderr = "error: unknown variable: x\n  ┌─ chapters/a.typ:3:2\n  │\n3 │ #x\n  │  ^\n";

  expect(parseTinymistDiagnostics(stderr, SOURCE, "main.typ")).toEqual([
    { severity: "error", message: "unknown variable: x", file: "chapters/a.typ", line: 3 },
  ]);
});

test("an error and a warning keep their order and severities, and absolute paths become relative", () => {
  const stderr = `warning: unused import\n  ┌─ ${SOURCE}/main.typ:1:9\n\nerror: expected content\n  ┌─ main.typ:7:1\n`;

  expect(parseTinymistDiagnostics(stderr, SOURCE, "main.typ")).toEqual([
    { severity: "warning", message: "unused import", file: "main.typ", line: 1 },
    { severity: "error", message: "expected content", file: "main.typ", line: 7 },
  ]);
});

test("text that is not a diagnostic becomes one error on the main file", () => {
  expect(parseTinymistDiagnostics("panic: boom\n", SOURCE, "main.typ")).toEqual([
    { severity: "error", file: "main.typ", message: "panic: boom" },
  ]);
});
