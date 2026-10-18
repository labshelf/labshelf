// Resolves the managed Tinymist binary, installing it on first use and reporting the install as progress.
import type { ManagedTinymist } from "./tinymistTypes.js";

export type ReportInstall = (message: string, fraction?: number) => void;

export async function ensureTinymistBinary(tinymist: ManagedTinymist, report: ReportInstall): Promise<string> {
  const installed = await tinymist.resolve();
  if (installed) { return installed; }
  report("Installing the Typst language server");
  return tinymist.ensure(({ message, fraction }) => { report(message, fraction); });
}
