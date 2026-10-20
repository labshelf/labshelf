// Checks an isolated copy of the source so the compiled sample and submitted files match.
import { constants, promises as fs } from "node:fs";
import * as path from "node:path";
import type { PublishCheckInput, PublishCheckReport } from "../../../templates/index.js";
import { checkTemplateForPublish, runSourceChecks } from "../../../templates/node/publish/index.js";
import { templateTreeProblem } from "../../../templates/manifest/index.js";

export async function checkPublishSnapshot(dataDir: string, input: PublishCheckInput, build: (folder: string) => ReturnType<PublishCheckInput["buildPdf"]>): Promise<PublishCheckReport> {
  const source = await runSourceChecks(input.projectFolder, input.manifest);
  if (!source.files || source.checks.some((c) => !c.ok)) return checkTemplateForPublish(input);
  const root = path.join(dataDir, "publishing");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(root, "template-"));
  const folder = path.join(staging, "src");
  await fs.mkdir(folder);
  try {
    for (const file of source.files) {
      const handle = await fs.open(file.absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Uint8Array;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink > 1 || stat.size > 5 * 1024 * 1024) throw new Error(`Unsafe template file "${file.path}"`);
        bytes = await handle.readFile();
      } finally { await handle.close(); }
      const problem = templateTreeProblem([{ ...file, size: bytes.length }]);
      if (problem) throw new Error(problem);
      const target = path.join(folder, ...file.path.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    return await checkTemplateForPublish({ ...input, projectFolder: folder, buildPdf: () => build(folder) });
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
