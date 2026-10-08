/** Parses the value of a `year:` operator into inclusive bounds. */

export interface YearBounds {
  min?: number;
  max?: number;
}

/**
 * Accepts `2017`, `2015..2020`, `2015..`, `..2020`, `>2018`, `>=2018`, `<2000` and `<=2000`.
 * @returns the bounds, or undefined when the value is none of those
 */
export function parseYearBounds(value: string): YearBounds | undefined {
  const range = /^(\d{4})?\.\.(\d{4})?$/.exec(value);
  if (range) {
    return { ...(range[1] ? { min: Number(range[1]) } : {}), ...(range[2] ? { max: Number(range[2]) } : {}) };
  }
  const comparison = /^([<>]=?)(\d{4})$/.exec(value);
  if (comparison) {
    const year = Number(comparison[2]);
    switch (comparison[1]) {
      case ">": return { min: year + 1 };
      case ">=": return { min: year };
      case "<": return { max: year - 1 };
      default: return { max: year };
    }
  }
  if (/^\d{4}$/.test(value)) { return { min: Number(value), max: Number(value) }; }
  return undefined;
}
