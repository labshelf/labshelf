// Declares template publication socket messages.
import type { HostToGallery, PublishDraft, PublishFromHost } from "../../templates/host/index.js";

type Envelope = { v: number; id: string; type: "publishTemplate"; projectId: string };
export type TemplatePublishRequest =
  | { action: "open" }
  | { action: "check"; draft: PublishDraft }
  | { action: "submit"; draft: PublishDraft; token: string };
export type TemplatePublishMessage = Envelope & TemplatePublishRequest;
export type TemplatePublishEvent = PublishFromHost | Extract<HostToGallery, { type: "notice" }>;
export type TemplatePublishReply = { v: number; id: string; type: "templatePublish"; event?: TemplatePublishEvent; done: boolean };
