// telegramHtml.ts — every notification body we store is Telegram parse-mode
// HTML built in src/formatter.ts, with all user content run through
// escapeHtml first. That markup is for Telegram, not the browser, so the
// dashboard must never dump it into the DOM as text (it reads as literal
// "<b>repo</b>") and must never inject it as HTML either.
//
// This turns the subset we emit into flat styled spans, so one body renders
// correctly in a digest card, in the 3P summary line, and in the .doc export.
// Anything unrecognised is dropped: a stray tag is never emitted as markup,
// and text is always re-escaped at the point of output.
//
// Pure, no imports — safe to bundle into the dashboard.

export type TgSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Only ever http(s) — see spansToHtml. */
  href?: string;
};

// Attributes may not contain ">"; our formatter never emits one that does.
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

function fromCode(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** `&amp;` is decoded last so `&amp;lt;` stays a literal "&lt;". */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => fromCode(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Flatten a body into styled spans. Nesting merges (`<b>a<code>b</code></b>`
 * yields a bold span and a bold+code span) because a flat list is all the
 * renderers need and it cannot go out of sync with a stack.
 */
export function parseTelegramHtml(input: string): TgSpan[] {
  const spans: TgSpan[] = [];
  let bold = 0;
  let italic = 0;
  let code = 0;
  const hrefs: string[] = [];
  let cursor = 0;

  const push = (text: string): void => {
    if (!text) return;
    spans.push({
      text: decodeEntities(text),
      ...(bold > 0 ? { bold: true } : {}),
      ...(italic > 0 ? { italic: true } : {}),
      ...(code > 0 ? { code: true } : {}),
      ...(hrefs.length > 0 ? { href: hrefs[hrefs.length - 1] } : {}),
    });
  };

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(input)) !== null) {
    push(input.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    switch (name) {
      case "b":
      case "strong":
        bold = closing ? Math.max(0, bold - 1) : bold + 1;
        break;
      case "i":
      case "em":
        italic = closing ? Math.max(0, italic - 1) : italic + 1;
        break;
      case "code":
      case "pre":
        code = closing ? Math.max(0, code - 1) : code + 1;
        break;
      case "a":
        if (closing) {
          hrefs.pop();
        } else {
          const h = HREF.exec(m[3]);
          hrefs.push((h?.[1] ?? h?.[2] ?? "").trim());
        }
        break;
      default:
        // u / s / blockquote / tg-spoiler / junk: drop the tag, keep the text.
        break;
    }
  }

  // Trailing text. A tag cut off mid-way (a truncated body) is dropped rather
  // than shown as a half-written "<b".
  const tail = input.slice(cursor);
  const open = tail.lastIndexOf("<");
  push(open !== -1 && !tail.slice(open).includes(">") ? tail.slice(0, open) : tail);
  return spans;
}

/** Cap by *rendered* length, so a tag or entity can never be split apart. */
export function trimSpans(spans: TgSpan[], max: number): TgSpan[] {
  const out: TgSpan[] = [];
  let used = 0;
  for (const s of spans) {
    if (used >= max) break;
    const room = max - used;
    if (s.text.length <= room) {
      out.push(s);
      used += s.text.length;
    } else {
      out.push({ ...s, text: s.text.slice(0, room) + "…" });
      break;
    }
  }
  return out;
}

/** Plain text for one-line summaries and other text-only contexts. */
export function plainText(input: string, max = Infinity): string {
  const joined = trimSpans(parseTelegramHtml(input), max)
    .map((s) => s.text)
    .join("");
  return joined;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Re-emit spans as HTML for the .doc export. Text is escaped here — spans hold
 * *decoded* text — and only http(s) hrefs survive, so nothing from a repo or
 * branch name can become a `javascript:` link.
 */
export function spansToHtml(spans: TgSpan[]): string {
  return spans
    .map((s) => {
      let html = esc(s.text);
      if (s.code) html = `<code>${html}</code>`;
      if (s.italic) html = `<i>${html}</i>`;
      if (s.bold) html = `<b>${html}</b>`;
      if (s.href && /^https?:\/\//i.test(s.href)) {
        html = `<a href="${esc(s.href)}">${html}</a>`;
      }
      return html;
    })
    .join("");
}
