// Loads the qmd item file fixtures, plus CRLF and no-final-newline variants built in memory so git never rewrites them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface QmdFixture { readonly name: string; readonly text: string }

export function readQmdFixture(name: string): string {
  return readFileSync(join(__dirname, name), "utf8");
}

export function qmdFixtures(): QmdFixture[] {
  const files = readdirSync(__dirname).filter((name) => name.endsWith(".qmd")).sort();
  const fixtures = files.map((name) => ({ name, text: readQmdFixture(name) }));
  return [
    ...fixtures,
    { name: "notes-math.qmd as CRLF", text: readQmdFixture("notes-math.qmd").replace(/\n/g, "\r\n") },
    { name: "task-list.qmd without final newline", text: readQmdFixture("task-list.qmd").replace(/\n$/, "") },
    { name: "cell-output.qmd as CR", text: readQmdFixture("cell-output.qmd").replace(/\n/g, "\r") },
  ];
}
