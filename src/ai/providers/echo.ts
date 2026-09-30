import type { AiProvider } from "./types.js";

// Deterministic stub. Used when AI_PROVIDER is unset or the real provider
// times out/errors — caller falls back to raw message (degraded, no AI text).
export const echoProvider: AiProvider = {
  name: "echo",
  async summarize(input) {
    const firstLine = input.message.split("\n")[0]?.slice(0, 120) ?? "";
    return `AI summary: ${firstLine}`;
  },
};
