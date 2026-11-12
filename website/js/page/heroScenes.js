// Starts the four scenes of the hero: the reader, the note, the Space and the manuscript.

import { initDiscuss } from "./heroDiscuss.js";
import { initExplore } from "./heroExplore.js";
import { initRead } from "./heroRead.js";
import { initWrite } from "./heroWrite.js";

export function initHeroScenes(show) {
  initRead(show);
  initExplore();
  initDiscuss();
  initWrite();
}
