/**
 * Declares stylesheets imported from TypeScript as text (esbuild "text" loader):
 * the content script injects the kit's tokens.css + base.css into shadow roots.
 */
declare module "*.css" {
  const text: string;
  export default text;
}
