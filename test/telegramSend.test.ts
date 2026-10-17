import { afterEach, describe, expect, it, vi } from "vitest";
import { answerCallbackQuery, editMessageText, sendMessage } from "../src/telegram.js";

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendMessage", () => {
  // The bug that made the bot look dead on Vercel: no token returned "ok".
  it("fails loudly when no token is configured instead of pretending success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await sendMessage("1", "hi");
    expect(out).toEqual({ ok: false, placeholder: true });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("TELEGRAM_BOT_TOKEN unset");
  });

  it("reports success on a 200", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(sendMessage("1", "hi")).resolves.toEqual({ ok: true, placeholder: false });
  });

  it("surfaces Telegram's rejection reason", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, description: "chat not found" }), {
            status: 400,
          }),
      ),
    );
    await expect(sendMessage("1", "hi")).resolves.toEqual({ ok: false, placeholder: false });
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain("telegram send rejected");
    expect(logged).toContain("chat not found");
  });

  it("never throws on a network error", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ETIMEDOUT");
      }),
    );
    await expect(sendMessage("1", "hi")).resolves.toEqual({ ok: false, placeholder: false });
  });

  it("never logs the token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "super-secret-token";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await sendMessage("1", "hi");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("super-secret-token");
  });

  it("posts HTML parse mode to the right endpoint", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendMessage("42", "<b>x</b>");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottok/sendMessage");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ chat_id: "42", text: "<b>x</b>", parse_mode: "HTML" });
  });

  it("attaches an inline keyboard when given one", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const replyMarkup = {
      inline_keyboard: [[{ text: "＋ o/r", callback_data: "sub:o/r" }]],
    };
    await sendMessage("42", "hi", { replyMarkup });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.reply_markup).toEqual(replyMarkup);
  });
});

describe("button plumbing", () => {
  it("answers a callback query so the button stops spinning", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(answerCallbackQuery("cb-1", "Subscribed to o/r")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottok/answerCallbackQuery");
    expect(JSON.parse(String(init.body))).toEqual({
      callback_query_id: "cb-1",
      text: "Subscribed to o/r",
    });
  });

  it("caps the toast text at Telegram's limit", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await answerCallbackQuery("cb-1", "x".repeat(500));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(String(body.text)).toHaveLength(190);
  });

  it("treats an expired tap as done rather than an error", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: false, description: "Bad Request: query is too old" }),
            { status: 400 },
          ),
      ),
    );
    await expect(answerCallbackQuery("cb-old")).resolves.toBe(true);
  });

  it("rewrites a message in place", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await editMessageText("42", 7, "<b>new</b>", {
      inline_keyboard: [[{ text: "✓ o/r", callback_data: "unsub:o/r" }]],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottok/editMessageText");
    expect(JSON.parse(String(init.body))).toMatchObject({
      chat_id: "42",
      message_id: 7,
      text: "<b>new</b>",
    });
  });

  it("treats 'message is not modified' as success", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: false, description: "Bad Request: message is not modified" }),
            { status: 400 },
          ),
      ),
    );
    await expect(editMessageText("42", 7, "same")).resolves.toEqual({
      ok: true,
      placeholder: false,
    });
  });
});
