// The 3D preview's camera (D13): the scene camera read from a plotly_relayout event, rounded to 4 decimals as the model stores it,
// and a subscription to those events on the plot div (Plotly adds `on` to the div when it draws).
import { isNumber } from "../../../guards/primitives.js";
import type { ChartLayout, ChartVec3 } from "../../chart/model.js";

type Camera = NonNullable<ChartLayout["camera"]>;
type RelayoutListener = (event: Readonly<Record<string, unknown>>) => void;

interface PlotEvents {
  on(name: string, listener: RelayoutListener): void;
  removeListener?(name: string, listener: RelayoutListener): void;
}

/** A number rounded to 4 decimals, with -0 written as 0. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4 + 0;
}

function vec3(value: unknown): ChartVec3 | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, z } = value as Record<string, unknown>;
  return isNumber(x) && isNumber(y) && isNumber(z) ? { x: round4(x), y: round4(y), z: round4(z) } : null;
}

/** The 'scene.camera' of a plotly_relayout event with every number rounded to 4 decimals, or null when the event has no valid one. */
export function cameraOfRelayout(event: Readonly<Record<string, unknown>>): ChartLayout["camera"] | null {
  const raw = event["scene.camera"];
  if (typeof raw !== "object" || raw === null) return null;
  const { eye, center, up } = raw as Record<string, unknown>;
  const e = vec3(eye);
  if (e === null) return null;
  const camera: Camera = { eye: e };
  const c = vec3(center);
  if (c !== null) camera.center = c;
  const u = vec3(up);
  if (u !== null) camera.up = u;
  return camera;
}

/** Calls `onCamera` for each plotly_relayout event of `plot` that carries a camera; nothing is subscribed while the div has no `on`. Returns the unsubscribe. */
export function watchCamera(plot: HTMLElement, onCamera: (camera: NonNullable<ChartLayout["camera"]>) => void): () => void {
  const events = plot as HTMLElement & Partial<PlotEvents>;
  if (typeof events.on !== "function") return () => undefined;
  const listener: RelayoutListener = (event) => {
    const camera = cameraOfRelayout(event ?? {});
    if (camera !== null && camera !== undefined) onCamera(camera);
  };
  events.on("plotly_relayout", listener);
  return () => { if (typeof events.removeListener === "function") events.removeListener("plotly_relayout", listener); };
}
