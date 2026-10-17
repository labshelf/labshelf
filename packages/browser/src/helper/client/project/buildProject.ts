// Runs a build in the helper and returns its outcome with the PDF bytes, verified against the announced SHA-256.
import { ChunkAssembler, type HelperCompileResult, type HelperProgressListener, type HelperProject, type ToPageMessage } from "@labshelf/core/helper";
import { sha256Hex } from "./fileHashes";
import type { HelperConnection } from "../connection";
import { progressOf } from "./helperProgress";

type Built = Extract<ToPageMessage, { type: "built" }>;
type Outcome = { built: Built; pdf?: Uint8Array };

function collectOutcome(onProgress: HelperProgressListener) {
  const assembler = new ChunkAssembler();
  let built: Built | undefined;
  return (message: ToPageMessage): { done: Outcome } | undefined => {
    if (message.type === "progress") { onProgress(progressOf(message)); return undefined; }
    if (message.type === "built") {
      if (message.status !== "succeeded") { return { done: { built: message } }; }
      if (!message.pdfSha256) { throw new Error("LabShelf Helper reported a successful build without pdfSha256"); }
      built = message;
      return undefined;
    }
    if (message.type !== "pdf") { return undefined; }
    if (!built) { throw new Error("LabShelf Helper sent PDF data before the build result"); }
    const added = assembler.add(message.chunk);
    if (added.status === "rejected") { throw new Error(`LabShelf Helper sent a bad PDF chunk: ${added.reason}`); }
    return added.status === "complete" ? { done: { built, pdf: added.bytes } } : undefined;
  };
}

export async function buildProject(connection: HelperConnection, project: HelperProject, onProgress: HelperProgressListener): Promise<HelperCompileResult> {
  const { projectId, main, engine } = project;
  const { built, pdf } = await connection.request({ type: "build", projectId, main, engine }, collectOutcome(onProgress));
  if (built.status !== "succeeded") { return { status: built.status, problems: built.problems }; }
  const actual = await sha256Hex(pdf as Uint8Array);
  if (actual !== built.pdfSha256) {
    throw new Error(`PDF from LabShelf Helper failed its SHA-256 check: expected ${built.pdfSha256}, got ${actual}`);
  }
  return { status: "succeeded", problems: built.problems, pdf: pdf as Uint8Array };
}
