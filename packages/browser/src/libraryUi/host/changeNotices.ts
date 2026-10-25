// Shows, as a toast on the library page, what the background did on its own, such as attaching a watched tab's PDF.
import { bx, type LibraryChangedBroadcast } from "../../platform";
import type { HostContext } from "./hostContext";

/** @returns a function that stops listening */
export function watchChangeNotices(ctx: HostContext): () => void {
  // Must stay synchronous and return nothing: a listener returning a Promise would answer popup requests with undefined.
  const onRuntime = (msg: unknown): void => {
    const change = msg as LibraryChangedBroadcast | undefined;
    if (change?.type === "library.changed" && change.notice) ctx.notice("ok", change.notice);
  };
  bx.runtime.onMessage.addListener(onRuntime);
  return () => bx.runtime.onMessage.removeListener(onRuntime);
}
