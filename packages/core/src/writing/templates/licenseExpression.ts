/** Checks that a licence string has the shape of an SPDX identifier or expression, without consulting the licence list. */
// CONTRACT: documents/contracts/templates.md#manifest

const REFUSED = new Set(["NOASSERTION", "NONE"]);
const IDENTIFIER = /^[A-Za-z0-9.+-]+$/;

function tokenize(text: string): string[] {
  return text.replace(/[()]/g, " $& ").split(/\s+/).filter((token) => token !== "");
}

// expression := term (("AND" | "OR") term)*   term := "(" expression ")" | id ("WITH" id)?
class ExpressionReader {
  private position = 0;
  constructor(private readonly tokens: readonly string[]) {}

  atEnd(): boolean { return this.position >= this.tokens.length; }

  private next(): string | undefined { return this.tokens[this.position++]; }
  private peek(): string | undefined { return this.tokens[this.position]; }

  private identifier(): boolean {
    const token = this.next();
    return token !== undefined && IDENTIFIER.test(token) && !["AND", "OR", "WITH"].includes(token);
  }

  private term(): boolean {
    if (this.peek() === "(") {
      this.next();
      return this.expression() && this.next() === ")";
    }
    if (!this.identifier()) { return false; }
    if (this.peek() === "WITH") { this.next(); return this.identifier(); }
    return true;
  }

  expression(): boolean {
    if (!this.term()) { return false; }
    while (this.peek() === "AND" || this.peek() === "OR") {
      this.next();
      if (!this.term()) { return false; }
    }
    return true;
  }
}

/** True for `MIT`, `MIT OR Apache-2.0` and `GPL-2.0+ WITH Classpath-exception-2.0`; false for `NOASSERTION`, `NONE` and malformed text. */
export function isLicenseExpression(text: string): boolean {
  if (REFUSED.has(text.trim())) { return false; }
  const reader = new ExpressionReader(tokenize(text));
  return reader.expression() && reader.atEnd();
}
