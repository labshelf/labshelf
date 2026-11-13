// Pins the continuation of a statement across a column or page break.
import { deriveContinuationTarget, deriveStatementContinuation, deriveStatementPart } from "../../src/reader/destRegion";
import { type PdfRegion } from "../../src/reader/geometry";
import { H, SPLIT, single, twoCol, line, body, THM, CONT, LEFT, RIGHT } from "./destRegionHarness";

describe("statement continuation", () => {
  const PROOF = "Proof. Apply the intermediate value argument to the function g";
  const pageNumber = line("12", 40, { x: 300, xEnd: 312 });
  const height = (r: PdfRegion): number => r.yTop - r.yBottom;

  it("continues a left-column statement at the top of the right column, until the Proof line", () => {
    const lines = [
      ...body(750, 10, LEFT),
      line(THM, 150, LEFT),
      line(CONT, 135, LEFT),
      line(CONT, 120, LEFT),
      line(CONT, 105, LEFT),
      line(CONT, 750, RIGHT),
      line(CONT, 735, RIGHT),
      line(PROOF, 720, RIGHT),
      ...body(705, 5, RIGHT),
    ];
    const part = deriveStatementPart(lines, twoCol, { x: 80, y: 155 })!;
    expect(part.runsOn).toBe(true);
    expect(part.region.yBottom).toBeLessThanOrEqual(105);
    expect(deriveContinuationTarget(twoCol, part.column)).toEqual({ pageOffset: 0, column: 1 });
    const next = deriveStatementContinuation(lines, twoCol, 1, part.heightLeft)!;
    expect(next).not.toBeNull();
    expect(next.x0).toBeGreaterThanOrEqual(SPLIT);
    expect(next.yTop).toBeGreaterThanOrEqual(750);
    expect(next.yBottom).toBeLessThanOrEqual(735);
    expect(next.yBottom).toBeGreaterThan(720);
  });

  it("continues a single-column statement on the next page past its running head, until the Proof line", () => {
    const first = [...body(750, 30), line(THM, 120), line(CONT, 105), line(CONT, 90), pageNumber];
    const part = deriveStatementPart(first, single, { x: 100, y: 125 })!;
    expect(part.runsOn).toBe(true);
    expect(part.region.yBottom).toBeGreaterThan(40);
    expect(deriveContinuationTarget(single, part.column)).toEqual({ pageOffset: 1, column: 0 });
    const second = [
      line("A. Author and B. Author: On continuous functions", 760, { x: 150, xEnd: 460 }),
      line(CONT, 720),
      line(CONT, 705),
      line(PROOF, 690),
      ...body(675, 10),
    ];
    const next = deriveStatementContinuation(second, single, 0, part.heightLeft)!;
    expect(next).not.toBeNull();
    expect(next.yTop).toBeGreaterThanOrEqual(720);
    expect(next.yTop).toBeLessThan(760);
    expect(next.yBottom).toBeLessThanOrEqual(705);
    expect(next.yBottom).toBeGreaterThan(690);
  });

  it("does not run on when a Proof or the next theorem ends the statement on its page", () => {
    const proof = [...body(750, 30), line(THM, 120), line(CONT, 105), line(PROOF, 90), pageNumber];
    expect(deriveStatementPart(proof, single, { x: 100, y: 125 })!.runsOn).toBe(false);
    const lemma = [...body(750, 30), line(THM, 120), line(CONT, 105), line("Lemma 2.2. Let g be continuous", 90), pageNumber];
    expect(deriveStatementPart(lemma, single, { x: 100, y: 125 })!.runsOn).toBe(false);
  });

  it("does not run on when a mid-page gap ends the statement", () => {
    const lines = [...body(750, 5), line(THM, 675), line(CONT, 660), line("a new paragraph of prose", 630), ...body(615, 3), pageNumber];
    expect(deriveStatementPart(lines, single, { x: 100, y: 680 })!.runsOn).toBe(false);
  });

  it("finds no continuation when the next page opens with a statement or section heading", () => {
    const first = [...body(750, 30), line(THM, 120), line(CONT, 105), line(CONT, 90), pageNumber];
    const part = deriveStatementPart(first, single, { x: 100, y: 125 })!;
    const lemma = [line("Lemma 3.1. Every bounded sequence has a convergent subsequence", 720), ...body(705, 10)];
    expect(deriveStatementContinuation(lemma, single, 0, part.heightLeft)).toBeNull();
    const section = [line("3 Main Results", 720), ...body(705, 10)];
    expect(deriveStatementContinuation(section, single, 0, part.heightLeft)).toBeNull();
  });

  it("keeps the first part and its continuation within half a page together", () => {
    const first = [...body(750, 4), line(THM, 380), ...Array.from({ length: 22 }, (_, i) => line(CONT, 365 - i * 15))];
    const part = deriveStatementPart(first, single, { x: 100, y: 385 })!;
    expect(part.runsOn).toBe(true);
    const second = Array.from({ length: 40 }, (_, i) => line(CONT, 740 - i * 15));
    const next = deriveStatementContinuation(second, single, 0, part.heightLeft);
    const total = height(part.region) + (next ? height(next) : 0);
    expect(total).toBeLessThanOrEqual(H / 2);
    expect(next).not.toBeNull();
  });
});
