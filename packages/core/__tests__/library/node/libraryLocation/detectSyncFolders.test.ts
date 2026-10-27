// Sources for the candidate folders (checked against each tool's documentation):
// - Dropbox: help.dropbox.com "Find the path of your Dropbox folder"; ~/.dropbox/info.json with personal/business.path;
//   macOS 12.5+ with File Provider uses ~/Library/CloudStorage/Dropbox.
// - Google Drive for desktop: support.google.com/drive/answer/10838124; macOS ~/Library/CloudStorage/GoogleDrive-<email>/My Drive
//   (the folder name is localized); Windows mounts a virtual drive that holds "My Drive".
// - OneDrive: support.microsoft.com "OneDrive folder"; macOS ~/Library/CloudStorage/OneDrive-<Name>; Windows %OneDrive%.
// - iCloud Drive: macOS ~/Library/Mobile Documents/com~apple~CloudDocs; Windows ~/iCloudDrive.
// - Nextcloud: docs.nextcloud.com/desktop "Configuration file"; nextcloud.cfg in ~/.config/Nextcloud (Linux),
//   ~/Library/Preferences/Nextcloud (macOS), %APPDATA%\Nextcloud (Windows); keys "N\Folders\M\localPath".
// - Syncthing: docs.syncthing.net/users/config; config.xml in ~/.local/state/syncthing (v1.27+), ~/.config/syncthing,
//   ~/Library/Application Support/Syncthing (macOS), %LOCALAPPDATA%\Syncthing (Windows); <folder path="...">.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../../src/ports/index";
import { detectSyncFolders } from "../../../../src/library/node/syncFolders";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function dir(...parts: string[]): Promise<string> {
  const target = path.join(...parts);
  await fs.mkdir(target, { recursive: true });
  return target;
}

async function file(target: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
}

function warnings(): ILogger & { warned: string[] } {
  const warned: string[] = [];
  return {
    warned,
    log: async (level, _module, message) => { if (level === "WARN") { warned.push(message); } },
    error: async () => undefined,
  };
}

describe("detectSyncFolders", () => {
  it("returns nothing for a home without sync folders", async () => {
    const home = await makeTempDir();
    expect(await detectSyncFolders({ home, env: {}, platform: "linux" })).toEqual([]);
  });

  it("finds ~/Dropbox, ~/Nextcloud and ~/OneDrive that exist", async () => {
    const home = await makeTempDir();
    await dir(home, "Dropbox");
    await dir(home, "Nextcloud");
    await dir(home, "OneDrive");
    expect(await detectSyncFolders({ home, env: {}, platform: "linux" })).toEqual([
      { tool: "dropbox", path: path.join(home, "Dropbox") },
      { tool: "onedrive", path: path.join(home, "OneDrive") },
      { tool: "nextcloud", path: path.join(home, "Nextcloud") },
    ]);
  });

  it("reads personal and business paths from .dropbox/info.json and deduplicates", async () => {
    const home = await makeTempDir();
    const personal = await dir(home, "Dropbox");
    const business = await dir(home, "Work Dropbox");
    await file(path.join(home, ".dropbox", "info.json"), JSON.stringify({
      personal: { path: personal }, business: { path: business },
    }));
    const found = await detectSyncFolders({ home, env: {}, platform: "linux" });
    expect(found).toEqual([{ tool: "dropbox", path: personal }, { tool: "dropbox", path: business }]);
  });

  it("skips a malformed info.json and warns", async () => {
    const home = await makeTempDir();
    await dir(home, "Dropbox");
    await file(path.join(home, ".dropbox", "info.json"), "{ not json");
    const logger = warnings();
    const found = await detectSyncFolders({ home, env: {}, platform: "linux", logger });
    expect(found).toEqual([{ tool: "dropbox", path: path.join(home, "Dropbox") }]);
    expect(logger.warned).toHaveLength(1);
  });

  it("ignores info.json paths that are relative, not strings or missing", async () => {
    const home = await makeTempDir();
    await file(path.join(home, ".dropbox", "info.json"), JSON.stringify({
      personal: { path: "relative/Dropbox" }, business: { path: 3 },
    }));
    expect(await detectSyncFolders({ home, env: {}, platform: "linux" })).toEqual([]);
  });

  it("finds Google Drive, OneDrive, Dropbox and iCloud under macOS CloudStorage and Mobile Documents", async () => {
    const home = await makeTempDir();
    const gdrive = await dir(home, "Library", "CloudStorage", "GoogleDrive-a@b.com", "Meu Drive");
    await dir(home, "Library", "CloudStorage", "GoogleDrive-a@b.com", "Shared drives");
    const onedrive = await dir(home, "Library", "CloudStorage", "OneDrive-Personal");
    const dropbox = await dir(home, "Library", "CloudStorage", "Dropbox");
    const icloud = await dir(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
    const found = await detectSyncFolders({ home, env: {}, platform: "darwin" });
    expect(found).toEqual(expect.arrayContaining([
      { tool: "googledrive", path: gdrive },
      { tool: "onedrive", path: onedrive },
      { tool: "dropbox", path: dropbox },
      { tool: "icloud", path: icloud },
    ]));
    expect(found).toHaveLength(4);
  });

  it("does not look in macOS locations on Linux", async () => {
    const home = await makeTempDir();
    await dir(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
    expect(await detectSyncFolders({ home, env: {}, platform: "linux" })).toEqual([]);
  });

  it("uses %OneDrive% and ~/iCloudDrive on Windows", async () => {
    const home = await makeTempDir();
    const onedrive = await dir(home, "Work", "OneDrive - Acme");
    const icloud = await dir(home, "iCloudDrive");
    const found = await detectSyncFolders({ home, env: { OneDrive: onedrive }, platform: "win32" });
    expect(found).toEqual(expect.arrayContaining([
      { tool: "onedrive", path: onedrive },
      { tool: "icloud", path: icloud },
    ]));
  });

  it("reads localPath entries from nextcloud.cfg", async () => {
    const home = await makeTempDir();
    const synced = await dir(home, "Cloud", "Lab");
    await file(
      path.join(home, ".config", "Nextcloud", "nextcloud.cfg"),
      `[General]\nfoo=bar\n\n[Accounts]\n0\\Folders\\1\\localPath=${synced}/\n0\\Folders\\1\\targetPath=/\n`,
    );
    expect(await detectSyncFolders({ home, env: {}, platform: "linux" })).toEqual([
      { tool: "nextcloud", path: synced },
    ]);
  });

  it("reads folder paths from Syncthing config.xml, expanding ~ and entities", async () => {
    const home = await makeTempDir();
    const plain = await dir(home, "Sync", "A&B");
    await dir(home, "Sync", "Tilde");
    await file(
      path.join(home, ".local", "state", "syncthing", "config.xml"),
      `<configuration version="37">\n<folder id="a" label="A" path="${plain.replace("&", "&amp;")}" type="sendreceive">` +
        `<device id="X"></device></folder>\n<folder id="b" path="~/Sync/Tilde"></folder>\n` +
        `<folder id="c" path="${home}/Missing"></folder>\n</configuration>`,
    );
    const found = await detectSyncFolders({ home, env: {}, platform: "linux" });
    expect(found).toEqual([
      { tool: "syncthing", path: plain },
      { tool: "syncthing", path: path.join(home, "Sync", "Tilde") },
    ]);
  });

  it("skips a truncated Syncthing config.xml and warns", async () => {
    const home = await makeTempDir();
    await dir(home, "Sync");
    await file(path.join(home, ".config", "syncthing", "config.xml"), `<configuration><folder id="a" path="${home}/Sync"`);
    const logger = warnings();
    expect(await detectSyncFolders({ home, env: {}, platform: "linux", logger })).toEqual([]);
    expect(logger.warned).toHaveLength(1);
  });

  it("honours XDG_STATE_HOME for the Syncthing config", async () => {
    const home = await makeTempDir();
    const state = await dir(home, "xdg-state");
    const synced = await dir(home, "Sync");
    await file(path.join(state, "syncthing", "config.xml"), `<configuration><folder id="a" path="${synced}"></folder></configuration>`);
    expect(await detectSyncFolders({ home, env: { XDG_STATE_HOME: state }, platform: "linux" })).toEqual([
      { tool: "syncthing", path: synced },
    ]);
  });
});
