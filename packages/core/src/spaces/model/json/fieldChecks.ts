// Checks the type of one field read from a synced JSON file.
export const isPage = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;
