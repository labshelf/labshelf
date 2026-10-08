/**
 * The state payload the list panel renders for one open folder, and the folder node shape the tree and panel share.
 * Path arithmetic comes from core; this maps it onto the webview's message fields.
 */
import { ROOT_LABEL, breadcrumbFor, countPapersUnder, isUnderDir, parentDir, relativeFolder } from '@labshelf/core';
import type { PaperRecord } from '@labshelf/core';

// A node is a "collection folder": a real directory under papers/ that is not
// itself a paper folder. The root node stands for papers/ itself.
export interface LibraryNode {
  label: string;
  dirPath: string;
  isRoot?: boolean;
}

export interface SubfolderEntry extends LibraryNode {
  count: number;
}

// A paper as the list panel sees it: the record plus where it sits relative to the open folder.
export interface ListPaper extends PaperRecord {
  folderPath: string;
  relFolder: string;
}

// Every paper in the library, trimmed to what the detail pane needs to find related papers outside the open folder.
export interface LibraryPaper {
  id: string;
  title: string;
  authors?: string[];
  year?: number;
  journal?: string;
  publisher?: string;
  keywords?: string[];
  tags?: string[];
  status: PaperRecord['status'];
  folderPath: string;
}

// What the reader's sidecar says about a paper: annotation count and the last reading position.
export interface PaperStats {
  annotations: number;
  lastPage?: number;
  lastRead?: string;
}

export interface ListPanelState {
  type: 'state';
  folder: LibraryNode;
  breadcrumb: LibraryNode[];
  subfolders: SubfolderEntry[];
  papers: ListPaper[];
  library: LibraryPaper[];
  stats?: Record<string, PaperStats>;
}

/** Builds the node that represents papers/ itself. */
export function rootNode(rootDir: string): LibraryNode {
  return { label: ROOT_LABEL, dirPath: rootDir, isRoot: true };
}

function libraryPaper(p: PaperRecord, sep: string): LibraryPaper {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    folderPath: parentDir(p.path, sep),
    ...(p.authors ? { authors: p.authors } : {}),
    ...(p.year ? { year: p.year } : {}),
    ...(p.journal ? { journal: p.journal } : {}),
    ...(p.publisher ? { publisher: p.publisher } : {}),
    ...(p.keywords ? { keywords: p.keywords } : {}),
    ...(p.tags ? { tags: p.tags } : {}),
  };
}

/** Assembles everything the list panel needs to render `folder`. */
export function buildListState(
  allPapers: PaperRecord[],
  folder: LibraryNode,
  rootDir: string,
  subfolders: LibraryNode[],
  sep: string,
): ListPanelState {
  const paths = allPapers.map((p) => p.path);
  return {
    type: 'state',
    folder,
    breadcrumb: breadcrumbFor(rootDir, folder.dirPath, sep).map((crumb) => ({
      label: crumb.label,
      dirPath: crumb.path,
      ...(crumb.isRoot ? { isRoot: true } : {}),
    })),
    subfolders: subfolders.map((s) => ({ ...s, count: countPapersUnder(paths, s.dirPath, sep) })),
    papers: allPapers
      .filter((p) => isUnderDir(p.path, folder.dirPath, sep))
      .map((p) => ({
        ...p,
        folderPath: parentDir(p.path, sep),
        relFolder: relativeFolder(p.path, folder.dirPath, sep),
      })),
    library: allPapers.map((p) => libraryPaper(p, sep)),
  };
}
