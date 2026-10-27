/** Verifies latexmk's `$biber` setting survives Perl's string rules and the shell, whatever the paths contain. */
import { execFileSync } from "node:child_process";

import { createBiberAssignment } from "../../../src/latex/biber/index";

const hasPerl = (() => { try { execFileSync("perl", ["-e", "1"]); return true; } catch { return false; } })();

/** What latexmk does with the setting: Perl evaluates it, then `sh` splits the line, with %O empty and %S the control file. */
function argvLatexmkRuns(assignment: string, controlFile: string): string[] {
  const line = execFileSync("perl", ["-e", `my $biber; ${assignment} print $biber;`], { encoding: "utf8" });
  const shell = line.replace("%O", "").replace("%S", `"${controlFile}"`);
  return execFileSync("sh", ["-c", `for a in ${shell}; do printf '%s\\0' "$a"; done`], { encoding: "utf8" }).split("\0").slice(0, -1);
}

describe("createBiberAssignment", () => {
  it("appends --biber and the root to the command, before latexmk's options and control file", () => {
    expect(createBiberAssignment({ command: ["/bin/helper"], root: "/p" })).toBe("$biber = '\\'/bin/helper\\' \\'--biber\\' \\'--root\\' \\'/p\\' %O %S';");
  });

  (hasPerl ? it : it.skip)("hands the program every argument intact through Perl and sh", () => {
    const command = ["/Applications/LabShelf Helper.app/Contents/MacOS/labshelf helper", "/odd\\path/it's \"x\" $HOME `id`"];
    const root = "/Users/x/Library/Application Support/LabShelf Helper/projects/O'Brien's/src";
    const controlFile = "/Users/x/Library/Application Support/LabShelf Helper/projects/p/build/main.tex/main.bcf";
    expect(argvLatexmkRuns(createBiberAssignment({ command, root }), controlFile)).toEqual([...command, "--biber", "--root", root, controlFile]);
  });
});
