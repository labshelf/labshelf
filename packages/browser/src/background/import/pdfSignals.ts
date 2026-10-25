// Tells which finished downloads and loaded tabs may be a PDF, and which of their addresses can be fetched again.

/** The fields of a finished download the watcher reads; `finalUrl` is Chrome's address after redirects. */
export interface FinishedDownload {
  url: string;
  finalUrl?: string;
  referrer?: string;
  filename: string;
  mime?: string;
}

export function isPdfDownload(item: FinishedDownload): boolean {
  return item.mime?.toLowerCase() === "application/pdf" || item.filename.toLowerCase().endsWith(".pdf");
}

/** A guess from the address alone; the %PDF header of the fetched bytes is the real check. */
export function isPdfUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return /\.pdf$/i.test(path) || /\/e?pdf(\/|$)/i.test(path);
}

// blob:, data: and file: addresses belong to the page or the disk; only the web can be asked again.
export function canRefetch(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
