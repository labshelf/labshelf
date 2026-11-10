/** The Account tab's Remote access over the core access: the app's on flag, the share Worker's bucket binding for the R2 store
 * and the storage of the app's last sync. Each host supplies the flag, the bucket and the last storage from its own stores. */
import type { AccountActionResult, AccountRemote, AccountRemoteDetails } from "../account/account.js";
import type { MirrorStatus } from "./mirrorRelay.js";
import type { MirrorStorage } from "./mirrorRunner.js";
import type { RemoteAccess, RemoteAccessResult } from "./remoteAccess.js";

const WARN_RATIO = 0.9;

export interface AccountRemoteDeps {
  flag: { read(): boolean | Promise<boolean>; write(on: boolean): Promise<void> };
  access: RemoteAccess;
  /** Binds or unbinds the R2 bucket on the share Worker; rejects with the reason. */
  bucket: { bind(): Promise<void>; unbind(): Promise<void> };
  /** The storage of the last sync run, undefined before any. */
  lastStorage(): MirrorStorage | undefined | Promise<MirrorStorage | undefined>;
}

/** The Mirror's status with the warning, full flag and left-out files of the last sync; before any sync they follow the status alone. */
export function mergeRemoteDetails(status: MirrorStatus, storage: MirrorStorage | undefined): AccountRemoteDetails {
  return {
    store: status.store, used: status.used, limit: status.limit, includePdfs: status.includePdfs, r2Bound: status.r2.bound,
    warn: storage?.warn ?? status.used >= status.limit * WARN_RATIO,
    full: storage?.full ?? status.used >= status.limit,
    leftOut: storage?.leftOut ?? [],
  };
}

const toActionResult = (result: RemoteAccessResult): AccountActionResult => (result.ok ? { ok: true } : { ok: false, message: result.message });

async function settle(task: () => Promise<void>): Promise<AccountActionResult> {
  try {
    await task();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : "The change failed." };
  }
}

/** `set` stores the flag only after the access succeeded; `details` is undefined while off or when the Mirror cannot be read;
 * moving to R2 binds the bucket first, moving back unbinds it after the move. */
export function createAccountRemote(deps: AccountRemoteDeps): AccountRemote {
  const { access } = deps;
  return {
    read: async () => ({ on: await deps.flag.read() }),
    set: async (on) => {
      const result = on ? await access.turnOn() : await access.turnOff();
      if (!result.ok) { return { ok: false, message: result.message }; }
      await deps.flag.write(on);
      return { ok: true };
    },
    details: async () => {
      try {
        if (!(await deps.flag.read())) { return undefined; }
        return mergeRemoteDetails(await access.status(), await deps.lastStorage());
      } catch {
        return undefined;
      }
    },
    estimatePaperPdfs: () => access.estimatePaperPdfs(),
    setIncludePdfs: async (on) => toActionResult(await access.setIncludePdfs(on)),
    setLimit: async (bytes) => toActionResult(await access.setLimit(bytes)),
    moveStore: async (store) => {
      if (store === "r2") {
        const bound = await settle(() => deps.bucket.bind());
        return bound.ok ? toActionResult(await access.moveStore("r2")) : bound;
      }
      const moved = toActionResult(await access.moveStore("do"));
      return moved.ok ? settle(() => deps.bucket.unbind()) : moved;
    },
  };
}
