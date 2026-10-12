import type { AiProvider, AiSummaryInput } from "./types.js";

// OpenAI-compatible chat provider: OpenAI itself, or any compatible gateway
// via AI_BASE_URL. No SDK dependency — plain fetch. Usage and spend are
// recorded per call and logged as JSON; when AI_MONTHLY_CAP_USD is reached,
// summarize() throws so the caller degrades to the raw message instead of
// spending more. Spend resets on restart (in-memory); the log lines are the
// durable record.

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
// Default rates are USD per 1M tokens (gpt-4o-mini); override per deployment.
const DEFAULT_INPUT_PRICE = 0.15;
const DEFAULT_OUTPUT_PRICE = 0.6;

const spendByMonth = new Map<string, number>();

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Current calendar-month spend in USD. */
export function monthlySpend(now: Date = new Date()): number {
  return spendByMonth.get(monthKey(now)) ?? 0;
}

/** Test hook: clear the in-memory spend ledger. */
export function resetAiSpend(): void {
  spendByMonth.clear();
}

function recordUsage(
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number },
): void {
  const inputPrice = Number(process.env.AI_INPUT_PRICE ?? DEFAULT_INPUT_PRICE) || 0;
  const outputPrice = Number(process.env.AI_OUTPUT_PRICE ?? DEFAULT_OUTPUT_PRICE) || 0;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const cost = (promptTokens / 1_000_000) * inputPrice + (completionTokens / 1_000_000) * outputPrice;
  const key = monthKey(new Date());
  const total = (spendByMonth.get(key) ?? 0) + cost;
  spendByMonth.set(key, total);
  console.log(
    JSON.stringify({
      msg: "ai_usage",
      model,
      promptTokens,
      completionTokens,
      estUsd: cost.toFixed(6),
      monthSpendUsd: total.toFixed(4),
    }),
  );
}

const SYSTEM_PROMPT =
  "Summarize this commit for a project progress tracker. " +
  "One or two terse, factual sentences in past tense. No hype, no SHAs, " +
  "no secrets, no markdown formatting.";

export const openaiCompatibleProvider: AiProvider = {
  name: "openai-compatible",
  async summarize(input: AiSummaryInput): Promise<string> {
    const apiKey = process.env.AI_API_KEY ?? "";
    if (!apiKey) throw new Error("ai_no_key");
    const cap = Number(process.env.AI_MONTHLY_CAP_USD ?? "");
    if (cap > 0 && monthlySpend() >= cap) throw new Error("ai_cap_exceeded");
    const model = process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
    const baseUrl = (process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 120,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Commit message:\n${input.message}\n\nDiff excerpt:\n${input.diffExcerpt}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ai_http_${res.status}`);
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("ai_empty");
    recordUsage(model, body.usage);
    return text;
  },
};
