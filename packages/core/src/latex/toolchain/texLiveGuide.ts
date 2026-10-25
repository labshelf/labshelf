// Points to the TeX Live install guide for an operating system.

/** The page that explains installing TeX Live on a Node `process.platform`. */
export function deriveTexLiveGuideUrl(platform: string): string {
  if (platform === "darwin") { return "https://www.tug.org/mactex/"; }
  if (platform === "win32") { return "https://www.tug.org/texlive/windows.html"; }
  return "https://www.tug.org/texlive/quickinstall.html";
}
