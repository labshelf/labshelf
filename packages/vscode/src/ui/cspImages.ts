// The img-src directive of a webview CSP: one place decides which image sources each kind of page may load.

/** 'none': no img-src (images fall back to default-src 'none'); 'data': extension and data: images (thumbnails); 'qmd': also blob:, which Plotly.toImage loads its rendered SVG through when exporting charts. */
export type CspImages = 'none' | 'data' | 'qmd';

/** The img-src directive with a leading space and a trailing semicolon, ready to splice into a CSP string; empty for 'none'. */
export function cspImageSource(cspSource: string, images: CspImages): string {
  if (images === 'none') return '';
  return images === 'data' ? ` img-src ${cspSource} data:;` : ` img-src ${cspSource} data: blob:;`;
}
