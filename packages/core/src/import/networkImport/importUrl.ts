/** Imports what a URL serves: a PDF under the name in the URL, or the paper a landing page describes. */
import { importPdf, isPdfBytes, type ImportOutcome } from "../../library/index.js";
import { errorMessage } from "../../logging/index.js";
import { fetchBytes, isHtml } from "./downloads.js";
import { NETWORK_IMPORT_MODULE, type NetworkImportEnv } from "./env.js";
import { importLandingPage } from "./importLandingPage.js";

/** @returns what happened */
export async function importUrl(env: NetworkImportEnv, url: string, targetDir: string): Promise<ImportOutcome> {
  const { ctx } = env;
  let tmp: string | undefined;
  try {
    const downloaded = await fetchBytes(env, url);
    if (!isPdfBytes(downloaded.bytes)) {
      if (!isHtml(downloaded)) { throw new Error("The URL did not return a PDF"); }
      return await importLandingPage(env, downloaded, url, targetDir);
    }
    tmp = ctx.paths.join(env.tmpDir, `download-${Date.now()}.pdf`);
    await ctx.fs.ensureDir(env.tmpDir);
    await ctx.fs.writeFile(tmp, downloaded.bytes);
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "download.pdf");
    return await importPdf(ctx, env.importDeps(), tmp, targetDir, {
      sourceName: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`,
    });
  } catch (error) {
    const message = errorMessage(error);
    await ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "URL import failed", { url, message });
    return { status: "failed", error: message, input: url };
  } finally {
    if (tmp) { await ctx.fs.deleteFile(tmp).catch(() => undefined); }
  }
}
