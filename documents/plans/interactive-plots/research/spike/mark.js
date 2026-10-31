// Runs first: starts the clock and records every CSP violation the page reports.
window.__spike = { t0: performance.now(), violations: [], done: false };
document.addEventListener("securitypolicyviolation", (event) => {
  window.__spike.violations.push({
    directive: event.effectiveDirective || event.violatedDirective,
    blocked: event.blockedURI,
    sample: (event.sample || "").slice(0, 80),
    source: event.sourceFile ? `${event.sourceFile.split("/").pop()}:${event.lineNumber}:${event.columnNumber}` : "",
  });
});
