/** The arXiv equation source on a paper that prints one display twice: the box text gives the LaTeX, but no number or label. */
import { gzipSync } from "node:zlib";
import { createArxivEquationSource } from "../../src/equations/arxivEquationSource.js";
import type { EprintCache } from "../../src/equations/arxivSource.js";
import type { FetchLike, ILogger } from "../../src/ports/index.js";

function tar(name: string, text: string): Uint8Array {
  const body = Buffer.from(text);
  const header = Buffer.alloc(512);
  header.write(name, 0);
  header.write("0000644\0", 100);
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  return new Uint8Array(Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512), Buffer.alloc(1024)]));
}

const MAIN = String.raw`\documentclass{article}
\begin{document}
\begin{equation} \frac{\partial u}{\partial t} = \alpha \nabla^2 u \label{eq:heat} \end{equation}
\appendix
\section{Proofs}
\begin{equation} \frac{\partial u}{\partial t} = \alpha \nabla^2 u \label{eq:heat-again} \end{equation}
\end{document}
`;

const logger: ILogger = { log: async () => undefined, error: async () => undefined };
const bytes = new Uint8Array(gzipSync(tar("main.tex", MAIN)));
const cache: EprintCache = { read: async () => bytes, write: async () => undefined };
const fetch: FetchLike = async () => { throw new Error("the cached e-print must be used"); };
const source = () => createArxivEquationSource({ recordOf: async () => ({ doi: "10.48550/arxiv.1312.6114" }), fetch, cache, logger });
const request = (text: string) => ({ paperId: "p", pageNumber: 1, rect: { x0: 0, x1: 1, yTop: 1, yBottom: 0 }, text, png: new Uint8Array([1]) });

describe("the arXiv equation source with a display printed twice", () => {
  it("returns the shared LaTeX without a number or label from the text alone", async () => {
    const found = await source().read(request("∂ u ∂ t = α ∇ 2 u"), () => undefined);
    expect(found?.latex).toBe(String.raw`\frac{\partial u}{\partial t} = \alpha \nabla^2 u`);
    expect(found?.number).toBeUndefined();
    expect(found?.label).toBeUndefined();
  });

  it("returns the number and label when the box carries the number", async () => {
    const found = await source().read(request("∂ u ∂ t = α ∇ 2 u (2)"), () => undefined);
    expect(found?.number).toBe("2");
    expect(found?.label).toBe("eq:heat-again");
  });
});
