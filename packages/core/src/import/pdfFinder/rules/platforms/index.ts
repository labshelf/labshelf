/** Exports the publisher rule table: every platform family's rules in one list. */
import type { PublisherRule } from "../publisherRule.js";
import { ATYPON_RULES } from "./atypon.js";
import { COMMERCIAL_PUBLISHER_RULES } from "./commercialPublishers.js";
import { OPEN_ACCESS_RULES } from "./openAccess.js";
import { PHYSICS_RULES } from "./physics.js";
import { SOCIETY_AND_ARCHIVE_RULES } from "./societies.js";
import { SPRINGER_NATURE_RULES } from "./springer.js";
import { WILEY_RULES } from "./wiley.js";

export const PUBLISHER_RULES: readonly PublisherRule[] = [
  ...ATYPON_RULES,
  ...WILEY_RULES,
  ...SPRINGER_NATURE_RULES,
  ...COMMERCIAL_PUBLISHER_RULES,
  ...PHYSICS_RULES,
  ...OPEN_ACCESS_RULES,
  ...SOCIETY_AND_ARCHIVE_RULES,
];
