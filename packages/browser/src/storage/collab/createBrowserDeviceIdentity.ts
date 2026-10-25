// Persists a library's device identity across browser tabs in IndexedDB.
import { DEVICE_ID, type DeviceIdentity, type ILogger } from "@labshelf/core";
import { openCollabDb } from "./openCollabDb";

export function createBrowserDeviceIdentity(libraryId: string, logger: ILogger): DeviceIdentity {
  return {
    async id() {
      try {
        const tx = (await openCollabDb()).transaction("maps", "readwrite");
        const key: [string, string] = [`library:${libraryId}`, "device-identity"];
        const saved = await tx.store.get(key);
        const id = saved?.["id"] ?? crypto.randomUUID();
        if (typeof id !== "string" || !DEVICE_ID.test(id)) {
          await tx.done;
          throw new Error(`Invalid device identity for library ${libraryId}`);
        }
        await Promise.all([!saved ? tx.store.put({ id }, key) : undefined, tx.done]);
        if (!saved) { await logger.log("INFO", "storage.deviceIdentity", "Created a device identity", { libraryId, id }); }
        return id;
      } catch (error) {
        await logger.error("storage.deviceIdentity", error, { libraryId });
        throw error;
      }
    },
  };
}
