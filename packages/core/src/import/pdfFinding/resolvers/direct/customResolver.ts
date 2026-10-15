/** Proposes the address each enabled custom resolver builds from the DOI; the downloader reads the page it answers with. */
import type { PdfResolver } from "../../types.js";

/** A template is usable when it is an http(s) address with a `{doi}` placeholder. */
export function isCustomResolverTemplate(template: string): boolean {
  return /^https?:\/\/\S+$/i.test(template) && template.includes("{doi}");
}

export const customResolver: PdfResolver = {
  name: "custom",
  async resolve(ctx) {
    const { doi } = ctx;
    if (!doi) return [];
    return (ctx.customResolvers ?? []).filter((r) => r.enabled).map((r) => r.template.replace("{doi}", doi));
  },
};
