/**
 * Reset, page chrome, keyboard keys and shared utility classes of the list webview.
 */
export const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --cols:26px minmax(0,1fr) 140px 50px 170px 84px 80px;
}
/* Narrow editors drop columns before the title gets squeezed: last read first, then the publication. */
@media (max-width:1080px){:root{--cols:26px minmax(0,1fr) 140px 50px 170px 80px}.col-read{display:none !important}}
@media (max-width:860px){:root{--cols:26px minmax(0,1fr) 120px 50px 80px}.col-pub{display:none !important}}
html,body{height:100%;overflow:hidden}
body{
  font-family:var(--ls-font);
  font-size:var(--ls-font-size);
  color:var(--ls-fg);
  background:var(--ls-bg);
  display:flex;flex-direction:column;
}
button{font:inherit;color:inherit}
kbd{
  display:inline-block;min-width:16px;padding:0 4px;border-radius:3px;font:inherit;font-size:10px;line-height:15px;text-align:center;
  background:var(--ls-kbd-bg);
  color:var(--ls-kbd-fg);
  border:1px solid var(--ls-kbd-border);
  border-bottom-color:var(--ls-kbd-bottom);
}
.mono{font-family:var(--ls-mono);font-size:11px}
.muted{color:var(--ls-desc);font-style:italic;font-size:11px;line-height:1.5}
.muted-text{color:var(--ls-desc)}
.tb-spacer{flex:1}
.spin{animation:ls-spin 1s linear infinite;display:inline-flex}
@keyframes ls-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
`;
