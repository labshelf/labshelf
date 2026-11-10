/** Contract of the arXiv equation source on a paper whose macro file defines its own equation numbering (\eqnr = \addtocounter + \tag), as Auto-Encoding Variational Bayes (1312.6114) does. */
import { gzipSync } from "node:zlib";
import { createArxivEquationSource } from "../../src/equations/arxivEquationSource.js";
import type { EprintCache } from "../../src/equations/arxivSource.js";
import type { FetchLike, ILogger } from "../../src/ports/index.js";

function tar(entries: Array<{ name: string; body: string }>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body);
    const header = Buffer.alloc(512);
    header.write(entry.name, 0);
    header.write("0000644\0", 100);
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(Buffer.concat(blocks));
}

const COMMANDS = String.raw`
\newcommand{\bb}[1]{\mathbf{#1}}
\newcommand{\bx}{\bb{x}}
\newcommand{\bxi}{\bx^{(i)}}
\newcommand{\bz}{\bb{z}}
\newcommand{\bT}{\boldsymbol{\theta}}
\newcommand{\bphi}{\boldsymbol{\phi}}
\newcommand{\pT}{p_{\bT}}
\newcommand{\qPhi}{q_{\bphi}}
\newcommand{\LB}[2]{\mathcal{L}^{#1}(\bT,\bphi; #2)}
\newcommand{\Exp}[2]{\mathbb{E}_{#1}\left[#2\right]}
\newcommand{\eqnr}{\addtocounter{equation}{1}\tag{\theequation}}
`;

const MAIN = String.raw`\documentclass{article}
\input{shared/commands.tex}
\begin{document}
\subsection{The variational bound}
\begin{align*}
\log \pT(\bxi) = D_{KL}(\qPhi(\bz|\bxi)||\pT(\bz|\bxi)) + \LB{}{\bxi}
\eqnr\end{align*}
which gives
\begin{align*}
\log \pT(\bxi) \geq \LB{}{\bxi}
&= \Exp{\qPhi(\bz|\bx)}{- \log \qPhi(\bz|\bx) + \log \pT(\bx,\bz)}
\eqnr\label{eq:lowerbound}\end{align*}
which can also be written as
\begin{align*}
\LB{}{\bxi} = - D_{KL}(\qPhi(\bz|\bxi) || \pT(\bz)) + \Exp{\qPhi(\bz|\bxi)}{\log \pT(\bxi | \bz)}
\eqnr\label{eq:lowerbound2}\end{align*}
Monte Carlo estimates
\begin{align}
\Exp{\qPhi(\bz|\bxi)}{f(\bz)} = \Exp{p(\bx)}{f(\bz)}
\end{align}
\end{document}
`;

const FIRST = String.raw`\log p_{\boldsymbol{\theta}}(\mathbf{x}^{(i)}) = D_{KL}(q_{\boldsymbol{\phi}}(\mathbf{z}|\mathbf{x}^{(i)})||p_{\boldsymbol{\theta}}(\mathbf{z}|\mathbf{x}^{(i)})) + \mathcal{L}^{}(\boldsymbol{\theta},\boldsymbol{\phi}; \mathbf{x}^{(i)})`;

/** The text pdf.js gives for equation (1) of the PDF: one item per glyph run, joined by spaces. */
const BOX_TEXT = "log p θ ( x ( i ) ) = D KL ( q φ ( z | x ( i ) ) || p θ ( z | x ( i ) )) + L ( θ , φ ; x ( i ) )";

const logger: ILogger = { log: async () => undefined, error: async () => undefined };

function source() {
  const bytes = new Uint8Array(gzipSync(tar([{ name: "main.tex", body: MAIN }, { name: "shared/commands.tex", body: COMMANDS }])));
  const cache: EprintCache = { read: async () => bytes, write: async () => undefined };
  const fetch: FetchLike = async () => { throw new Error("the cached e-print must be used"); };
  return createArxivEquationSource({ recordOf: async () => ({ doi: "10.48550/arxiv.1312.6114" }), fetch, cache, logger });
}

const request = (text: string) => ({
  paperId: "p2013auto", pageNumber: 3, rect: { x0: 0, x1: 1, yTop: 1, yBottom: 0 }, text, png: new Uint8Array([1]),
});

describe("the arXiv equation source with an \\eqnr macro that numbers by \\addtocounter and \\tag", () => {
  it("A1 reads the first display equation from its text alone, without the number commands", async () => {
    const found = await source().read(request(BOX_TEXT), () => undefined);
    expect(found?.latex).toBe(FIRST);
  });

  it("A2 numbers the first display equation (1) when the box text carries its number", async () => {
    const found = await source().read(request(`${BOX_TEXT} (1)`), () => undefined);
    expect(found?.latex).toBe(FIRST);
    expect(found?.number).toBe("1");
  });
});
