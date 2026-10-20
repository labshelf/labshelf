// Pins when the picked folder counts as usable and the error a refused folder gives.
import { FolderAccessError, grantedFolder } from "../../../src/storage/picked/folderPermission";

const handle = (state?: PermissionState) => ({
  name: "Papers",
  queryPermission: state && (async () => state),
}) as unknown as FileSystemDirectoryHandle;

describe("grantedFolder", () => {
  it("returns a folder with read and write permission", async () => {
    const granted = handle("granted");
    await expect(grantedFolder(granted)).resolves.toBe(granted);
  });

  it.each(["prompt", "denied"] as const)("refuses a folder whose permission is %s, naming it", async (state) => {
    const refused = grantedFolder(handle(state));
    await expect(refused).rejects.toBeInstanceOf(FolderAccessError);
    await expect(grantedFolder(handle(state))).rejects.toThrow(/"Papers"/);
  });

  it("lets a context without the permission API try the call itself", async () => {
    const bare = handle();
    await expect(grantedFolder(bare)).resolves.toBe(bare);
  });
});
