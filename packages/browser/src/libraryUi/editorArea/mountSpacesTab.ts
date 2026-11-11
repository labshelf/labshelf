// Serves the Spaces host over an in-page loopback and mounts a core Spaces view on its UI end.
import {
  answerNoteFileRequest, createLibraryLayout, createLoopbackTransport, formatLocalDay, posixPathOps, serveSpaces,
  type HostToSpaces, type NoteFileReply, type NoteFileRequest, type SpacesToHost,
} from "@labshelf/core";
import type { EditorTabBody } from "@labshelf/core/dom";
import { getBrowserCellPorts } from "../../helper";
import { createBrowserNoteFileIo } from "../../storage";
import type { TabContext } from "./tabKinds";

type SpacesUi = ReturnType<typeof createLoopbackTransport<SpacesToHost, HostToSpaces>>["ui"];

/** `mount` shows the view in `host` and returns what removes it; disposing stops the view, then the serving. */
export function mountSpacesTab(
  host: HTMLElement,
  ctx: Pick<TabContext, "spaces" | "logger" | "fs" | "paperObjects">,
  mount: (host: HTMLElement, ui: SpacesUi) => () => void,
): EditorTabBody {
  const { ui, host: endpoint } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const cells = getBrowserCellPorts(ctx.logger);
  const io = createBrowserNoteFileIo(ctx.fs);
  const layout = createLibraryLayout("", posixPathOps.join);
  // A Space note's files sit beside it: notes/x.qmd keeps its assets in spaces/<id>/notes/assets/.
  const noteFiles = (spaceId: string, notePath: string, request: NoteFileRequest): Promise<NoteFileReply> =>
    answerNoteFileRequest(io, posixPathOps.join(layout.spaceDir(spaceId), posixPathOps.dirname(notePath)), request);
  const stop = serveSpaces(endpoint, { ...ctx.spaces, author: () => ctx.spaces.author(), logger: ctx.logger, noteFiles, today: () => formatLocalDay(Date.now()), runCell: cells.runCell, runMath: cells.runMath, restartCell: cells.restartCell, installPython: cells.installPython,
    ...(ctx.paperObjects ? { paperObjects: ctx.paperObjects } : {}) });
  const dispose = mount(host, ui);
  return { dispose: () => { dispose(); stop(); } };
}
