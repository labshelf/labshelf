// Names the extensions allowed to launch LabShelf Helper.
// CONTRACT: documents/contracts/helper.md#transport
export const HELPER_HOST_NAME = "dev.labshelf.helper";

/** Chromium accepts exact origins only. The Web Store id is added when the store item exists. */
export const HELPER_ALLOWED_ORIGINS: string[] = ["chrome-extension://ghcjlkjggiffdekaneoaoklhedjeeklh/"];

export const HELPER_FIREFOX_EXTENSIONS: string[] = ["labshelf@lucanaasser.dev"];
