/**
 * Declares the shape of one design token: a default (dark) value and an optional light override.
 */
export interface DesignToken {
  value: string;
  light?: string;
}

export function token(value: string, light?: string): DesignToken {
  return light === undefined ? { value } : { value, light };
}
