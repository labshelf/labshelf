// Validates template publication fields crossing the helper socket.
import { TEMPLATE_CATEGORIES } from "../../templates/templateManifest/index.js";
import { PUBLISH_CHECK_IDS } from "../../templates/publishCheckLabels.js";
import {
  FieldError, readBody, readBoolean, readChoice, readProjectId, readString, readText, readArray,
  optional, isBody, type Body,
} from "../messageFields.js";
import type { TemplatePublishEvent, TemplatePublishRequest } from "./messages.js";

function boundedText(body: Body, key: string): string {
  const value = readString(body, key);
  if (value.length > 20_000) throw new FieldError("limit", `${key} exceeds 20000 characters`);
  return value;
}

export function readTemplatePublishRequest(body: Body): TemplatePublishRequest {
  const action = readChoice(body, "action", ["open", "check", "submit"]);
  if (action === "open") return { action };
  const raw = readBody(body, "draft");
  const draft = {
    name: boundedText(raw, "name"), category: readChoice(raw, "category", TEMPLATE_CATEGORIES),
    license: boundedText(raw, "license"), description: boundedText(raw, "description"),
  };
  if (action === "check") return { action, draft };
  const token = boundedText(body, "token");
  if (!token.trim()) throw new FieldError("invalid-field", "token is empty");
  return { action, draft, token };
}

export function readTemplatePublishEvent(body: Body): TemplatePublishEvent {
  const event = readBody(body, "event");
  switch (event.type) {
    case "notice": return { type: "notice", kind: readChoice(event, "kind", ["info", "error"]), text: readString(event, "text") };
    case "publish.open": {
      const p = readBody(event, "project");
      const d = readBody(event, "draft");
      return { type: "publish.open", project: { id: readProjectId({ projectId: p.id }), title: readString(p, "title"), engineLabel: readText(p, "engineLabel") },
        draft: { name: readString(d, "name"), category: readChoice(d, "category", TEMPLATE_CATEGORIES), license: readString(d, "license"), description: readString(d, "description") } };
    }
    case "publish.checks": return {
      type: "publish.checks", running: readBoolean(event, "running"), ...optional(event, "thumbnail", readString),
      checks: readArray(event, "checks", PUBLISH_CHECK_IDS.length).map((c) => {
        if (!isBody(c)) throw new FieldError("invalid-field", "check is not an object");
        return { id: readChoice(c, "id", PUBLISH_CHECK_IDS), ...optional(c, "ok", readBoolean), ...optional(c, "message", readString) };
      }),
    };
    case "publish.auth": return { type: "publish.auth", ...optional(event, "login", readText), ...optional(event, "error", readString) };
    case "publish.failed": return { type: "publish.failed", error: readString(event, "error") };
    case "publish.submitted": return { type: "publish.submitted", url: readText(event, "url") };
    default: throw new FieldError("invalid-field", "unknown template publication event");
  }
}
