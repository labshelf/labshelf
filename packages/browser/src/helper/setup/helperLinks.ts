// Maps the browser's OS to the LabShelf Helper installer to download, and names the macOS opening guide.
const RELEASES = "https://github.com/labshelf/labshelf/releases/latest";

// The release workflow publishes installers under these names.
const ASSET_BY_OS: Record<string, string> = {
  mac: "labshelf-helper-macos.pkg",
  win: "labshelf-helper-windows-setup.exe",
  linux: "labshelf-helper-linux.deb",
};

/** The installer for `os` (a `runtime.getPlatformInfo()` value); other systems get the releases page. */
export function helperDownloadUrl(os: string): string {
  const asset = ASSET_BY_OS[os];
  return asset ? `${RELEASES}/download/${asset}` : RELEASES;
}

/** The manual section that explains how to open the unsigned macOS installer. */
export const MACOS_GUIDE_URL = "https://github.com/labshelf/labshelf#helper-macos";
