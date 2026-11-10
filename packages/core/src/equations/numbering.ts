/**
 * The LaTeX equation counter as a document is read in order: plain numbers, numbers within
 * the chapter or section (\numberwithin, book and report classes), letters after \appendix, and
 * subequations that share one number with a letter each (3a, 3b), and the author's own moves of the
 * counter (\addtocounter, \setcounter, \stepcounter on `equation`) with \theequation as its current value.
 */

type Unit = "chapter" | "section";

export class EquationNumbering {
  private equation = 0;
  private chapter = 0;
  private section = 0;
  private within: Unit | undefined;
  private hasChapters = false;
  private inAppendix = false;
  private sub: { parent: string; count: number } | undefined;

  /** A class with chapters (book, report) numbers equations within the chapter unless told otherwise. */
  useChapters(): void {
    this.hasChapters = true;
    this.within ??= "chapter";
  }

  numberWithin(unit: string): void {
    if (unit === "chapter" || unit === "section") this.within = unit;
  }

  stepChapter(): void {
    this.hasChapters = true;
    this.chapter += 1;
    this.section = 0;
    if (this.within) this.equation = 0;
  }

  stepSection(): void {
    this.section += 1;
    if (this.within === "section") this.equation = 0;
  }

  appendix(): void {
    this.inAppendix = true;
    if (this.hasChapters) this.chapter = 0;
    else this.section = 0;
  }

  /** \begin{subequations} steps the counter once; the equations inside share that number. */
  beginSubequations(): void {
    this.sub = { parent: this.nextPlain(), count: 0 };
  }

  endSubequations(): void {
    this.sub = undefined;
  }

  /** Steps the counter for one numbered row and returns its number as the PDF shows it. */
  next(): string {
    if (!this.sub) return this.nextPlain();
    this.sub.count += 1;
    return this.sub.parent + letter(this.sub.count, false);
  }

  /** \addtocounter{equation}{n}; inside subequations it moves the letter counter, as LaTeX does. */
  addToCounter(n: number): void {
    if (this.sub) this.sub.count += n;
    else this.equation += n;
  }

  /** \setcounter{equation}{n}. */
  setCounter(n: number): void {
    if (this.sub) this.sub.count = n;
    else this.equation = n;
  }

  /** \theequation: the counter's current value as the PDF prints it, without stepping it. */
  current(): string {
    if (this.sub) return this.sub.parent + letter(this.sub.count, false);
    return this.prefix() + String(this.equation);
  }

  private nextPlain(): string {
    this.equation += 1;
    return this.prefix() + String(this.equation);
  }

  private prefix(): string {
    if (!this.within) return "";
    const chapter = this.hasChapters && this.inAppendix ? letter(this.chapter, true) : String(this.chapter);
    if (this.within === "chapter") return chapter + ".";
    if (this.hasChapters) return `${chapter}.${this.section}.`;
    return (this.inAppendix ? letter(this.section, true) : String(this.section)) + ".";
  }
}

function letter(n: number, upper: boolean): string {
  if (n < 1 || n > 26) return String(n);
  return String.fromCharCode((upper ? 64 : 96) + n);
}
