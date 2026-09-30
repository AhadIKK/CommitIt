// Provider interface: new model = new file, no core edits (AGENTS.md).
export type AiSummaryInput = {
  sha: string;
  message: string;
  diffExcerpt: string;
};

export type AiProvider = {
  name: string;
  summarize: (input: AiSummaryInput) => Promise<string>;
};
