// Turns the Publish form and its project into the template manifest the checks and the submission carry.
import { projectIdSlug } from "../../writing/project/index.js";
import { serializeTemplateManifest, TEMPLATE_CATEGORIES, type TemplateManifest } from "../templateManifest/index.js";
import type { PublishDraft } from "../protocol/index.js";
import type { PublishFile } from "../publishCheckReport.js";
import type { PublishableProject } from "./publishPorts.js";

const MAX_ID_LENGTH = 60;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
/** The manifest needs one author before sign-in; the submission replaces it with the GitHub login. */
const PLACEHOLDER_AUTHOR = "unsigned";

export type PublishTemplateManifestResult = { ok: true; manifest: TemplateManifest } | { ok: false; error: string };

/** The page is untrusted, so the draft is validated again here. */
export function createPublishTemplateManifest(draft: PublishDraft, project: PublishableProject): PublishTemplateManifestResult {
  const name = draft.name.trim();
  if (name === "") { return { ok: false, error: "Give the template a name." }; }
  if (name.length > MAX_NAME_LENGTH) { return { ok: false, error: `The name is over ${MAX_NAME_LENGTH} characters.` }; }
  const category = TEMPLATE_CATEGORIES.find((c) => c === draft.category);
  if (category === undefined) { return { ok: false, error: `Category must be one of ${TEMPLATE_CATEGORIES.join(", ")}.` }; }
  const description = draft.description.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) { return { ok: false, error: `The description is over ${MAX_DESCRIPTION_LENGTH} characters.` }; }
  const id = projectIdSlug(name).slice(0, MAX_ID_LENGTH).replace(/-+$/, "");
  const { format, engine, main } = project;
  return { ok: true, manifest: { id, name, description, category, format, engine, main, license: draft.license.trim(), authors: [PLACEHOLDER_AUTHOR] } };
}

/** Replaces template.yaml in the checked files with a copy that names `login` as the author. */
export function withAuthors(files: readonly PublishFile[], manifest: TemplateManifest, login: string): PublishFile[] {
  const yaml = new TextEncoder().encode(serializeTemplateManifest({ ...manifest, authors: [login] }));
  return files.map((file) => (file.path === "template.yaml" ? { path: file.path, bytes: yaml } : file));
}
