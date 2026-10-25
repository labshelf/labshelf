/** Names the build folder of one root file, distinct per root path. */

// Roots with the same basename in different folders must not share auxiliary files.
export function rootBuildFolder(root: string): string {
  return root.replaceAll("/", "__");
}
