// Exports the Spaces page protocol: its messages and the parsers that validate page input.
export { SPACE_TABS } from "./messages.js";
export type {
  HostToSpaces, PaperPickItem, SpaceMutation, SpacesEndpoint, SpacesToHost, SpacesTransport, SpaceTab,
} from "./messages.js";
export { parseSpacesMessage } from "./parseSpacesMessage.js";
export { parseDateDraft, parseTermDraft } from "./parseSpaceDrafts.js";
