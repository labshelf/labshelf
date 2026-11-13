// Regression: hover previews on real page geometry, lines extracted with pdf.js the way PageTextCache does.
import { deriveStatementRegion, findFloatCaptionNear, findStatementStart } from "../../src/reader/destRegion";
import type { TextLine } from "../../src/reader/textLines";
import { deriveFloatRegion, type PdfRegion } from "../../src/reader/geometry";
import { line, body } from "./destRegionHarness";

// Regression: hover previews on real page geometry, lines extracted with pdf.js the way PageTextCache does.
const PAGE = { width: 612, height: 792, columnSplit: null };
const at = (y: number, x: number, xEnd: number, text: string, height = 12): TextLine => ({ text, x, xEnd, y, height, column: 0 });

const contains = (r: PdfRegion, l: TextLine): boolean => r.yTop >= l.y + 0.7 * l.height && r.yBottom <= l.y;
const excludesAbove = (r: PdfRegion, l: TextLine): boolean => l.y >= r.yTop;
const excludesBelow = (r: PdfRegion, l: TextLine): boolean => l.y + 0.7 * l.height <= r.yBottom;

describe('statement preview of a hyperref theorem link (Green & Tao, arXiv math/0404188, page 2)', () => {
  // amsart theorems share the subsection counter: the links point at "subsection.1.1" / "subsection.1.2", XYZ dests whose
  // y sits in the gap above the heading, about 8pt under the previous paragraph's last baseline.
  const before11 = at(515.7, 81.5, 332.2, 'Our main theorem resolves the above conjecture.');
  const thm11 = [
    at(494.1, 81.5, 525.2, 'Theorem 1.1. The prime numbers contain infinitely many arithmetic progressions of'),
    at(480.2, 81.5, 171.9, 'length k for all k.'),
  ];
  const before12 = at(458.6, 81.5, 320.0, 'In fact, we can say something a little stronger:');
  const thm12 = [
    at(437.1, 81.5, 525.2, 'Theorem 1.2 (Szemer´edi’s theorem in the primes). Let A be any subset of the prime'),
    at(423.2, 81.5, 525.2, 'numbers of positive relative upper density, thus lim sup π(N)−1|A ∩ [1, N]| > 0,'),
    at(420.3, 371.2, 395.7, 'N→∞', 8),
    at(409.3, 81.5, 525.2, 'where π(N) denotes the number of primes less than or equal to N. Then A contains'),
    at(395.3, 81.5, 388.5, 'infinitely many arithmetic progressions of length k for all k.'),
  ];
  const after12 = at(373.8, 81.5, 525.1, 'If one replaces “primes” in the statement of Theorem 1.2 by the set of all positive integers');
  // The whole body of page 2 as pdf.js extracts it, so the column's median line pitch is the body spacing (about 13.9pt)
  // and not the paragraph gap.
  const head = [
    at(755.7, 81.5, 379.3, '2 BEN GREEN AND TERENCE TAO', 9),
    at(731.9, 81.5, 525.2, 'such result is due to Heath-Brown [25]. He showed that there are infinitely many 4-term'),
    at(717.9, 81.5, 525.1, 'progressions consisting of three primes and a number which is either prime or a product'),
    at(704.0, 81.5, 525.2, 'of two primes. In a somewhat different direction, let us mention the beautiful results of'),
    at(690.0, 81.5, 525.1, 'Balog [2, 3]. Among other things he shows that for any m there are m distinct primes'),
    at(676.1, 81.5, 389.7, 'p , . . . , p such that all of the averages 1(p + p ) are prime.'),
    at(674.3, 87.4, 328.3, '1 m 2 i j', 8),
    at(651.2, 81.5, 525.2, 'The problem of finding long arithmetic progressions in the primes has also attracted the'),
    at(637.2, 81.5, 525.0, 'interest of computational mathematicians. At the time of writing the longest known'),
    at(623.3, 81.5, 525.2, 'arithmetic progression of primes is of length 23, and was found in 2004 by Markus Frind,'),
    at(609.3, 81.5, 264.6, 'Paul Underwood, and Paul Jobling:'),
    at(589.4, 162.2, 444.5, '56211383760397 + 44546738095860k; k = 0, 1, . . . , 22.'),
    at(569.5, 81.5, 525.1, 'An earlier arithmetic progression of primes of length 22 was found by Moran, Pritchard'),
    at(555.6, 81.5, 171.4, 'and Thyssen [32]:'),
    at(535.7, 165.2, 441.5, '11410337850553 + 4609098694200k; k = 0, 1, . . . , 21.'),
  ];
  const tail = [
    at(359.9, 81.5, 525.1, 'Z+, then this is a famous theorem of Szemer´edi [38]. The special case k = 3 of Theorem'),
    at(345.8, 81.5, 525.0, '1.2 was recently established by the first author [21] using methods of Fourier analysis.'),
    at(331.9, 81.5, 525.0, 'In contrast, our methods here have a more ergodic theory flavour and do not involve'),
    at(318.0, 81.5, 525.0, 'much Fourier analysis (though the argument does rely on Szemer´edi’s theorem which'),
    at(304.1, 81.5, 525.0, 'can be proven by either combinatorial, ergodic theory, or Fourier analysis arguments).'),
    at(290.0, 81.5, 525.0, 'We also remark that if the primes were replaced by a random subset of the integers,'),
    at(276.1, 81.5, 525.1, 'with density at least N−1/2+ε on each interval [1, N], then the k = 3 case of the above'),
    at(262.2, 81.5, 244.6, 'theorem was established in [30].'),
    at(237.2, 81.5, 525.0, 'Acknowledgements The authors would like to thank Jean Bourgain, Enrico Bombieri,'),
    at(223.3, 81.5, 525.2, 'Tim Gowers, Bryna Kra, Elon Lindenstrauss, Imre Ruzsa, Roman Sasyk, Peter Sarnak'),
    at(209.4, 81.5, 525.2, 'and Kannan Soundararajan for helpful conversations. We are particularly indebted to'),
    at(195.5, 81.5, 525.2, 'Andrew Granville for drawing our attention to the work of Goldston and Yıldırım, and to'),
    at(181.4, 81.5, 525.4, 'Dan Goldston for making the preprint [17] available. We are also indebted to Yong-Gao'),
    at(167.5, 81.5, 525.1, 'Chen and his students, Bryna Kra, Jamie Radcliffe, Lior Silberman and Mark Watkins'),
    at(153.6, 81.5, 525.2, 'for corrections to earlier versions of the manuscript. We are particularly indebted to'),
    at(139.7, 81.5, 525.2, 'the anonymous referees for a very thorough reading and many helpful corrections and'),
    at(125.7, 81.5, 525.2, 'suggestions, which have been incorporated into this version of the paper. Portions of'),
    at(111.7, 81.5, 525.2, 'this work were completed while the first author was visiting UCLA and Universit´e de'),
    at(97.8, 81.5, 525.0, 'Montr´eal, and he would like to thank these institutions for their hospitality. He would'),
    at(83.9, 81.5, 471.1, 'also like to thank Trinity College, Cambridge for support over several years.'),
  ];
  const lines = [...head, before11, ...thm11, before12, ...thm12, after12, ...tail];

  it('1.3a crops Theorem 1.2 from its heading to its last line, not the line above the anchor', () => {
    const region = deriveStatementRegion(lines, PAGE, { x: 81.5155487, y: 467.154053 });
    expect(region).not.toBeNull();
    for (const l of thm12) { expect(contains(region!, l)).toBe(true); }
    expect(excludesAbove(region!, before12)).toBe(true);
    expect(excludesBelow(region!, after12)).toBe(true);
  });

  it('1.3a crops Theorem 1.1 from its heading to its last line, not the line above the anchor', () => {
    const region = deriveStatementRegion(lines, PAGE, { x: 81.5155487, y: 524.367798 });
    expect(region).not.toBeNull();
    for (const l of thm11) { expect(contains(region!, l)).toBe(true); }
    expect(excludesAbove(region!, before11)).toBe(true);
    expect(excludesBelow(region!, before12)).toBe(true);
  });

  it('1.3c findStatementStart returns the heading line index for the Theorem 1.2 anchor', () => {
    const idx = findStatementStart(lines, PAGE, { x: 81.5155487, y: 467.154053 });
    expect(idx).toBe(lines.indexOf(thm12[0]!));
  });

  it('1.3c findStatementStart returns the heading line index for the Theorem 1.1 anchor', () => {
    const idx = findStatementStart(lines, PAGE, { x: 81.5155487, y: 524.367798 });
    expect(idx).toBe(lines.indexOf(thm11[0]!));
  });

  it('A1 the Theorem 1.2 anchor yields a start at the heading and a region of exactly the statement', () => {
    const dest = { x: 81.5155487, y: 467.154053 };
    const idx = findStatementStart(lines, PAGE, dest);
    expect(idx).not.toBeNull();
    expect(lines[idx!]!.text).toMatch(/^Theorem 1\.2/);
    const region = deriveStatementRegion(lines, PAGE, dest);
    expect(region).not.toBeNull();
    for (const l of thm12) { expect(contains(region!, l)).toBe(true); }
    expect(excludesAbove(region!, before12)).toBe(true);
    expect(excludesBelow(region!, after12)).toBe(true);
  });
});

describe('figure preview of a hyperref figure link (Mnih et al. 2013, "Playing Atari", page 7)', () => {
  // Figure 2 is four plots ABOVE its caption; their small-font tick labels and axis titles are extracted as text and
  // the four panels' labels on one baseline join into page-wide lines. Figure 3's graphic and caption follow below.
  const lines = [
    at(704.8, 134.8, 481.9, 'Average Reward on Breakout Average Reward on Seaquest Average Q on Breakout Average Q on Seaquest', 4),
    at(702.0, 114.1, 419.8, '250 1800 4 9', 4),
    at(696.3, 211.5, 419.8, '1600 3.5 8', 4),
    at(691.8, 114.1, 419.8, '200 1400 7', 4),
    at(689.3, 317.9, 320.2, '3', 4),
    at(685.0, 211.5, 419.8, '1200 6', 4),
    at(681.6, 114.1, 320.2, '150 2.5', 4),
    at(679.4, 211.5, 419.8, '1000 5', 4),
    at(676.5, 317.9, 320.2, '2', 4),
    at(673.7, 213.8, 419.8, '800 4', 4),
    at(671.4, 114.1, 320.2, '100 1.5', 4),
    at(668.0, 213.8, 419.8, '600 3', 4),
    at(662.4, 213.8, 419.8, '400 1 2', 4),
    at(661.3, 116.4, 120.9, '50', 4),
    at(656.7, 213.8, 419.8, '200 0.5 1', 4),
    at(651.1, 118.6, 419.8, '0 0 0 0', 4),
    at(647.5, 122.0, 503.1, '0 10 20 30 40 50 60 70 80 90 100 0 10 20 30 40 50 60 70 80 90 100 0 10 20 30 40 50 60 70 80 90 100', 4),
    at(643.5, 146.7, 474.9, 'Training Epochs Training Epochs Training Epochs Training Epochs', 4),
    at(610.3, 108.0, 504.0, 'Figure 2: The two plots on the left show average reward per episode on Breakout and Seaquest', 10),
    at(599.4, 108.0, 504.0, 'respectively during training. The statistics were computed by running an ε-greedy policy with ε =', 10),
    at(588.4, 108.0, 504.0, '0.05 for 10000 steps. The two plots on the right show the average maximum predicted action-value', 10),
    at(577.5, 108.0, 504.0, 'of a held out set of states on Breakout and Seaquest respectively. One epoch corresponds to 50000', 10),
    at(566.5, 108.0, 368.1, 'minibatch weight updates or roughly 30 minutes of training time.', 10),
    at(463.0, 108.0, 504.0, 'Figure 3: The leftmost plot shows the predicted value function for a 30 frame segment of the game', 10),
    at(452.0, 108.0, 482.2, 'Seaquest. The three screenshots correspond to the frames labeled by A, B, and C respectively.', 10),
  ];

  it('1.3a shows the whole figure above its caption, not the space below the caption', () => {
    // Link "figure.2": XYZ dest at y = 642.228, just under the plots.
    const hit = findFloatCaptionNear(lines, PAGE, { floatKind: 'figure', label: '2' }, { x: 108, y: 642.228 });
    expect(hit).not.toBeNull();
    expect(lines[hit!.lineIndex]!.text).toMatch(/^Figure 2:/);
    const region = deriveFloatRegion(lines, hit!, PAGE.width, PAGE.height, PAGE.columnSplit);
    // The plot titles at the top of the figure and the whole caption are inside; Figure 3's caption is not.
    expect(contains(region, lines[0]!)).toBe(true);
    expect(contains(region, lines[22]!)).toBe(true);
    expect(excludesBelow(region, lines[23]!)).toBe(true);
  });

  it('A2 covers the four plot titles, the plots and the caption of Figure 2', () => {
    const hit = findFloatCaptionNear(lines, PAGE, { floatKind: 'figure', label: '2' }, { x: 108, y: 642.228 });
    expect(hit).not.toBeNull();
    const region = deriveFloatRegion(lines, hit!, PAGE.width, PAGE.height, PAGE.columnSplit);
    expect(contains(region, lines[0]!)).toBe(true); // plot titles
    expect(contains(region, lines[17]!)).toBe(true); // x-axis titles
    for (const i of [18, 19, 20, 21, 22]) { expect(contains(region, lines[i]!)).toBe(true); }
  });
});

