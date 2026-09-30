import { echoProvider } from "./echo.js";
import type { AiProvider } from "./types.js";

export function getProvider(): AiProvider {
  const which = (process.env.AI_PROVIDER ?? "echo").toLowerCase();
  // Future: openai.ts, anthropic.ts, etc. — add file + case, no core edits.
  switch (which) {
    case "echo":
    default:
      return echoProvider;
  }
}
