// Runs the checks that need no build: licence, paths, latexmkrc and sizes, on the files a template would keep.
// CONTRACT: documents/contracts/templates.md#paths

import { isLicenseExpression, templateSizeProblem, templateStructureProblem, type TemplateManifest } from "../../manifest/index.js";
import type { PublishCheckId } from "../../publishCheckLabels.js";
import { listProjectFiles } from "../projectFiles.js";
import type { FoundFile } from "../walkFolder.js";

type SourceCheckId = Extract<PublishCheckId, "license" | "paths" | "latexmkrc" | "sizes">;
export interface SourceCheck {
  id: SourceCheckId;
  ok: boolean;
  message?: string;
}

const NOT_LISTED = "Not checked: the project's files could not be listed.";

// latexmk runs a latexmkrc found in the project, which could run any command during the build.
const isLatexmkrc = (path: string): boolean => path.split("/").some((segment) => ["latexmkrc", ".latexmkrc"].includes(segment.toLowerCase()));

function result(id: SourceCheckId, problem: string | undefined): SourceCheck {
  return problem === undefined ? { id, ok: true } : { id, ok: false, message: problem };
}

function licenseProblem(manifest: TemplateManifest): string | undefined {
  return isLicenseExpression(manifest.license) ? undefined : `"${manifest.license}" is not an SPDX license identifier.`;
}

/** The four source checks in display order, and the project's files when they could be listed. */
export async function runSourceChecks(
  projectFolder: string,
  manifest: TemplateManifest,
): Promise<{ checks: SourceCheck[]; files: FoundFile[] | undefined }> {
  const license = result("license", licenseProblem(manifest));
  let files: FoundFile[];
  try {
    files = await listProjectFiles(projectFolder);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { files: undefined, checks: [license, result("paths", reason), result("latexmkrc", NOT_LISTED), result("sizes", NOT_LISTED)] };
  }
  const rc = files.find((file) => isLatexmkrc(file.path));
  const kept = files.filter((file) => !isLatexmkrc(file.path));
  return {
    files,
    checks: [
      license,
      result("paths", templateStructureProblem(kept)),
      result("latexmkrc", rc === undefined ? undefined : `"${rc.path}" is a latexmkrc, which could run commands during the build.`),
      result("sizes", templateSizeProblem(files)),
    ],
  };
}
