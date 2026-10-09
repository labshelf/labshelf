/** Turns pdf.js' low-level parser errors into messages the user can act on. */

export function describePdfError(error: unknown): Error {
  const name = (error as { name?: unknown })?.name;
  const message = error instanceof Error ? error.message : String(error);

  if (name === "PasswordException") {
    return new Error("The PDF is password-protected and could not be read.");
  }
  if (name === "InvalidPDFException" || /\b(root reference|xref|invalid pdf)\b/i.test(message)) {
    return new Error("The PDF is corrupted or incomplete and could not be read.");
  }
  return error instanceof Error ? error : new Error(message);
}
