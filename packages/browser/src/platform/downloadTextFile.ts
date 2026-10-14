/** Saves text as a file through the browser's download dialog, for the reader's and the library page's exports. */
import { bx } from "./browserApi";

export async function downloadTextFile(fileName: string, text: string, mimeType: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  try {
    await bx.downloads.download({ url, filename: fileName, saveAs: true });
  } finally {
    // The download has its own copy once started; a cancelled dialog needs nothing either.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
