// Runs the wasm biber in Node on a .bcf and its .bib files and writes the .bbl, for comparison with native biber.
// Usage: node run-biber.cjs <distDir> <out.bbl> <file.bcf> [file.bib ...]; prints {exit, initMs, runMs} as JSON.
const fs = require("node:fs");
const path = require("node:path");

const [dist, outFile, bcf, ...bibs] = process.argv.slice(2);
const workDir = "/home/web_user/biber";

(async () => {
  const t0 = performance.now();
  const log = [];
  const Module = await require(path.resolve(dist, "biber.js"))({
    noInitialRun: true,
    locateFile: (name) => path.resolve(dist, name),
    print: (line) => log.push(line),
    printErr: (line) => log.push(line),
  });
  const t1 = performance.now();
  Module.FS.mkdirTree(workDir);
  Module.FS.chdir(workDir);
  for (const file of [bcf, ...bibs]) Module.FS.writeFile(path.basename(file), fs.readFileSync(file));
  const bbl = path.basename(bcf).replace(/\.bcf$/, ".bbl");
  let exit;
  try {
    exit = Module.callMain(["/opt/perl-wasm/bin/biber", "--nolog", `--outfile=${bbl}`, path.basename(bcf)]);
  } catch (e) {
    if (typeof e.status !== "number") throw e;
    exit = e.status;
  }
  const t2 = performance.now();
  if (Module.FS.analyzePath(`${workDir}/${bbl}`).exists) fs.writeFileSync(outFile, Module.FS.readFile(`${workDir}/${bbl}`));
  if (exit !== 0) console.error(log.join("\n"));
  console.log(JSON.stringify({ exit, initMs: Math.round(t1 - t0), runMs: Math.round(t2 - t1) }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
