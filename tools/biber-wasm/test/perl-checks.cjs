// Checks the two defects a wasm biber can have: XML::LibXML returning undecoded bytes, and colliding Data::Uniqid ids.
// Usage: node perl-checks.cjs <distDir>; exits non-zero when a check fails.
const path = require("node:path");

const dist = process.argv[2];
const script = String.raw`
use strict; use warnings;
use XML::LibXML; use Data::Uniqid qw(suniqid);
my $text = XML::LibXML->load_xml(string => qq(<?xml version="1.0" encoding="UTF-8"?><a>\xC3\xA4</a>))->documentElement->textContent;
printf "libxml-utf8 length=%d is_utf8=%d %s\n", length($text), utf8::is_utf8($text) ? 1 : 0,
  (length($text) == 1 && utf8::is_utf8($text)) ? "PASS" : "FAIL";
my %seen; $seen{suniqid()}++ for 1 .. 5000;
my $dups = 5000 - keys %seen;
printf "uniqid calls=5000 duplicates=%d %s\n", $dups, $dups ? "FAIL" : "PASS";
`;

(async () => {
  const lines = [];
  const Module = await require(path.resolve(dist, "biber.js"))({
    noInitialRun: true,
    locateFile: (name) => path.resolve(dist, name),
    print: (line) => lines.push(line),
    printErr: (line) => lines.push(line),
  });
  try {
    Module.callMain(["-e", script]);
  } catch (e) {
    if (typeof e.status !== "number") throw e;
  }
  console.log(lines.join("\n"));
  process.exit(lines.filter((l) => l.endsWith("PASS")).length === 2 ? 0 : 1);
})();
