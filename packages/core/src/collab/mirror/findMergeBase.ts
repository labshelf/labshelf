// Chooses the closest stored text as the base for an outside disk edit.
import { lineSimilarity } from "../../writing/text/index.js";
import type { MirrorContext } from "./mirrorContext.js";

export function mergeDiskText(context: MirrorContext, path: string, docText: string, diskText: string, parent?: string) {
  const versions = context.store.storedVersions(path);
  const recorded = versions.find((version) => version.hash === parent);
  if (recorded) { return context.mergeText({ base: recorded.text, local: docText, other: diskText, otherLabel: "disk" }); }
  const agreed = context.store.bases.get(path);
  let base = versions.find((version) => version.text === agreed)?.text;
  let similarity = base === undefined ? -1 : lineSimilarity(base, diskText);
  for (const version of [...versions].reverse()) {
    const score = lineSimilarity(version.text, diskText);
    if (score > similarity) { base = version.text; similarity = score; }
  }
  return base === undefined ? undefined : context.mergeText({ base, local: docText, other: diskText, otherLabel: "disk" });
}
