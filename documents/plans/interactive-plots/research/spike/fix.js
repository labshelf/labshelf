// Candidate core fix, loaded only on the "+ fix" rows: before Plotly loads, create the <style> elements Plotly looks up
// by id, carrying the page's script nonce. Plotly then finds them and adds its rules through CSSOM (insertRule on an
// allowed sheet), which the nonce-only style-src permits. The maplibre one is only pre-created so its import-time
// injection is skipped (no map traces are used). Core would do this in the plot loader before `import("../plot/plotly.js")`.
(() => {
  const nonce = document.querySelector("script[nonce]")?.nonce ?? "";
  for (const id of ["plotly.js-style-global", "9f215cf04c5486422605d13261cb87401f4e7763b6296af81e98efbc0130da53"]) {
    if (document.getElementById(id)) continue;
    const style = document.createElement("style");
    style.id = id;
    style.nonce = nonce;
    document.head.appendChild(style);
  }
})();
