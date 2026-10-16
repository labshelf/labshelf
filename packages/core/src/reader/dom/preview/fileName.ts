// Names a build root by the last segment of its path, on either path separator.
export const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
