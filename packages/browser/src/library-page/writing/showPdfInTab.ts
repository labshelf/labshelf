// Opens PDF bytes in a browser tab with the browser's own PDF viewer.
import { bx } from "../../platform";

const URL_LIFETIME_MS = 60_000;

export async function showPdfInTab(bytes: Uint8Array): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/pdf" }));
  // The tab needs the URL only while it loads the bytes.
  setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MS);
  await bx.tabs.create({ url });
}
