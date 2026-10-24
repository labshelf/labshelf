// Validates a message from the Details surface: the channel envelope here, the wrapped message by its own protocol's guard.
import { parseUiMessage } from "../../protocol/index.js";
import { parseAllProjectsMessage } from "../../../writing/allProjects/protocol/index.js";
import type { DetailsToHost } from "./detailsMessages.js";

/** @returns the message when its channel is known and the wrapped message passes that channel's guard, else null */
export function parseDetailsMessage(raw: unknown): DetailsToHost | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { channel, msg } = raw as Record<string, unknown>;
  if (channel === "library") {
    const inner = parseUiMessage(msg);
    return inner ? { channel, msg: inner } : null;
  }
  if (channel === "projects") {
    const inner = parseAllProjectsMessage(msg);
    return inner ? { channel, msg: inner } : null;
  }
  return null;
}
