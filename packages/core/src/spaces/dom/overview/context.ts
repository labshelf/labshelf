// Declares the dependencies used by the Space Overview.
import type { HostToSpaces, SpacesTransport } from "../../protocol/index.js";
export type SpaceSnapshot = Extract<HostToSpaces, { type: "space" }>;
export interface OverviewContext {
  data: SpaceSnapshot;
  end: SpacesTransport;
  readOnly: boolean;
  signal?: AbortSignal;
}
