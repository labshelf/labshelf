// Draws one 2D line plot and one 3D surface with the global Plotly, recording timings on window.__spike.
(async () => {
  const spike = window.__spike;
  spike.tLoaded = performance.now() - spike.t0;
  try {
    if (typeof window.Plotly === "undefined") throw new Error("Plotly global missing (bundle blocked or failed)");
    const p2d = document.getElementById("p2d");
    const p3d = document.getElementById("p3d");
    const x = Array.from({ length: 50 }, (_, i) => i / 5);
    await window.Plotly.react(p2d, [{ type: "scatter", mode: "lines+markers", x, y: x.map(Math.sin), name: "sin" }],
      { width: 600, height: 360, margin: { l: 50, r: 20, t: 30, b: 40 }, hovermode: "closest", title: { text: "2D" } });
    spike.t2d = performance.now() - spike.t0;
    const n = 30;
    const z = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Math.sin(i / 4) * Math.cos(j / 4)));
    await window.Plotly.react(p3d, [{ type: "surface", z, showscale: !("noscale" in document.body.dataset) }], { width: 600, height: 460, margin: { l: 0, r: 0, t: 30, b: 0 }, title: { text: "3D" } });
    spike.t3d = performance.now() - spike.t0;
  } catch (error) {
    spike.error = String(error && error.stack ? error.stack : error);
  }
  spike.done = true;
})();
