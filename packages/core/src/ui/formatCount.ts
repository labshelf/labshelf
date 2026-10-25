/** Words a count with its English noun: "1 paper", "3 papers". */
export function formatCount(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
