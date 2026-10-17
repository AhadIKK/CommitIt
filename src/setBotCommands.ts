import "dotenv/config";
import { BOT_COMMANDS } from "./telegramUi.js";

// Registers the bot's "/" command menu — this is what makes Telegram clients
// autofill and describe commands while they are typed, including the menu
// button in groups.
//
// Run after editing BOT_COMMANDS:   npm run bot:setup
// Needs TELEGRAM_BOT_TOKEN (read from .env). Idempotent: it replaces the menu.

async function api(method: string, payload: unknown): Promise<unknown> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!body.ok) throw new Error(`${method} failed: ${body.description ?? res.status}`);
  return body.result;
}

async function main(): Promise<void> {
  await api("setMyCommands", { commands: BOT_COMMANDS });
  console.log("setMyCommands ok");
  try {
    // Make the menu button render the command list (Telegram's default, set
    // explicitly so group chats get the same "/" menu as private chats).
    await api("setChatMenuButton", { menu_button: { type: "commands" } });
    console.log("setChatMenuButton ok");
  } catch (err) {
    console.warn(`setChatMenuButton skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  const registered = (await api("getMyCommands", {})) as {
    command: string;
    description: string;
  }[];
  console.log(`${registered.length} commands live:`);
  for (const c of registered) console.log(`  /${c.command} — ${c.description}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
