import { echoProvider } from "./echo.js";
import { openaiCompatibleProvider } from "./openaiCompatible.js";
import type { AiProvider } from "./types.js";

export function getProvider(): AiProvider {
  const which = (process.env.AI_PROVIDER ?? "echo").toLowerCase();
  // Future: anthropic.ts, etc. — add file + case, no core edits.
  switch (which) {
    case "openai":
      return openaiCompatibleProvider;
    case "echo":
    default:
      return echoProvider;
  }
}
