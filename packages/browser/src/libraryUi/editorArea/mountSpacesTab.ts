// Serves the Spaces host over an in-page loopback and mounts a core Spaces view on its UI end.
import { createLoopbackTransport, formatLocalDay, serveSpaces, type SpacesToHost, type HostToSpaces } from "@labshelf/core";
import type { EditorTabBody } from "@labshelf/core/dom";
import type { TabContext } from "./tabKinds";

type SpacesUi = ReturnType<typeof createLoopbackTransport<SpacesToHost, HostToSpaces>>["ui"];

/** `mount` shows the view in `host` and returns what removes it; disposing stops the view, then the serving. */
export function mountSpacesTab(
  host: HTMLElement,
  ctx: Pick<TabContext, "spaces" | "logger">,
  mount: (host: HTMLElement, ui: SpacesUi) => () => void,
): EditorTabBody {
  const { ui, host: endpoint } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const stop = serveSpaces(endpoint, { ...ctx.spaces, logger: ctx.logger, today: () => formatLocalDay(Date.now()) });
  const dispose = mount(host, ui);
  return { dispose: () => { dispose(); stop(); } };
}
