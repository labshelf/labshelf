// Follows one compile request to its result: progress, the build outcome and the changed pages cut from the payload.
import type { HelperCompileResult, OnHelperProgress, ToPageMessage } from "@labshelf/core/helper";
import type { FrameStep } from "../connection";
import { deriveProgress } from "./helperProgress";

type Built = Extract<ToPageMessage, { type: "built" }>;
type Pages = Extract<ToPageMessage, { type: "pages" }>;

function pagesOf(pages: Pages, payload: Uint8Array): HelperCompileResult["changed"] {
  return pages.changed.map(({ index, offset, length }) => {
    if (offset + length > payload.length) {
      throw new Error(`LabShelf Helper announced page ${index} at ${offset}+${length} but sent ${payload.length} bytes`);
    }
    return { index, bytes: payload.slice(offset, offset + length) };
  });
}

export function createCompileStep(onProgress: OnHelperProgress): FrameStep<HelperCompileResult> {
  let built: Built | undefined;
  return (message, payload) => {
    if (message.type === "progress") { onProgress(deriveProgress(message)); return undefined; }
    if (message.type === "built") {
      if (message.status !== "succeeded") { return { done: { status: message.status, problems: message.problems, changed: [] } }; }
      built = message;
      return undefined;
    }
    if (message.type !== "pages") { return undefined; }
    if (!built) { throw new Error("LabShelf Helper sent pages before the build result"); }
    return {
      done: {
        status: "succeeded",
        problems: built.problems,
        pdfSha256: message.pdfSha256,
        pageCount: message.pageCount,
        changed: pagesOf(message, payload),
      },
    };
  };
}
