/** The error the helper's field readers throw for a refused field; parseHelperMessage turns it into a HelperRejection. */

import type { HelperRejectionKind } from "./helperMessages.js";

/** Thrown only inside the parser, which turns it into a HelperRejection. */
export class FieldError extends Error {
  constructor(readonly code: HelperRejectionKind, message: string) {
    super(message);
  }
}
