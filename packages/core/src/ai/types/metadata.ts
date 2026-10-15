/**
 * Declares the structured AI-extracted metadata of a paper, produced by heuristics in this package.
 * The consumer persists it (VS Code: paper_metadata_ai table).
 */

export interface CodeRepoRef {
  url: string;
  provider: "github" | "gitlab" | "other";
  status?: "active" | "missing" | "unknown";
  stars?: number;
  lastChecked?: number;
}

export interface ComputeDisclosure {
  acceleratorModel?: string;
  acceleratorCount?: number;
  trainingHours?: number;
  estimatedCostUsd?: number;
  rawSnippet?: string;
}

export interface ReproducibilityScore {
  score: number;
  hasCode: boolean;
  hasData: boolean;
  hasHyperparams: boolean;
  hasSeeds: boolean;
  hasHardwareDetails: boolean;
}

export interface AiPaperMetadata {
  paperId: string;
  methods: string[];
  datasets: string[];
  codeRepos: CodeRepoRef[];
  reproducibility: ReproducibilityScore;
  compute?: ComputeDisclosure;
  limitations: string[];
  difficultyProfile: Record<number, number>;
  indexedAt: number;
}
