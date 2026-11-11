/** Synthetic PDF pages for the paper-object tests: page 1 holds equation (3) and Figure 2, page 2 Table 1. */
import type { PdfPageText } from "../../src/paperObjects/index";
import type { TextItemBox } from "../../src/reader/textLines";

export const item = (str: string, x: number, y: number, width: number, height = 10): TextItemBox => ({ str, x, y, width, height });

const prose = (y: number): TextItemBox => item("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.", 72, y, 456);

export function samplePages(): PdfPageText[] {
  return [
    {
      pageNumber: 1, width: 600, height: 800,
      items: [
        prose(700), prose(680), prose(660),
        item("E = mc^2", 250, 640, 60), item("(3)", 510, 640, 18),
        prose(620),
        item("Figure 2. A plot of things.", 72, 300, 300),
      ],
    },
    {
      pageNumber: 2, width: 600, height: 800,
      items: [
        item("Table 1: Results of the study", 72, 700, 250),
        item("Method", 72, 680, 60), item("Acc", 250, 680, 40), item("Time", 400, 680, 40),
        item("Ours", 72, 666, 40), item("91.2", 250, 666, 40), item("3.1", 400, 666, 30),
        item("Base", 72, 652, 40), item("88.0", 250, 652, 40), item("2.9", 400, 652, 30),
        prose(500), prose(486),
        item("Figure 2. Continued.", 72, 200, 150),
      ],
    },
  ];
}
