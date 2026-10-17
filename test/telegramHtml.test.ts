import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  parseTelegramHtml,
  plainText,
  spansToHtml,
  trimSpans,
} from "../dashboard/src/telegramHtml.js";

// Notification bodies are Telegram parse-mode HTML (src/formatter.ts). The
// dashboard used to print them as text, so digests read as
// "<b>mohd-Affan16/Cloud-ai</b> — api-working". These are the shapers that fix
// that without ever injecting stored markup into the DOM.

// The body from the reported dashboard screenshot.
const OBSERVED =
  "📊 <b>mohd-Affan16/Cloud-ai</b> — api-working •\n" +
  "<b>iyaazms1-dot</b> — 1 commits: <code>fix</code> <code>3db4b35</code> AI summary: local storage mission";

describe("parseTelegramHtml", () => {
  it("flattens the observed digest body into readable text", () => {
    expect(plainText(OBSERVED)).toBe(
      "📊 mohd-Affan16/Cloud-ai — api-working •\n" +
        "iyaazms1-dot — 1 commits: fix 3db4b35 AI summary: local storage mission",
    );
  });

  it("marks emphasis for the renderer instead of dropping it", () => {
    expect(parseTelegramHtml("<b>repo</b> — main")).toEqual([
      { text: "repo", bold: true },
      { text: " — main" },
    ]);
    expect(parseTelegramHtml("<code>3db4b35</code>")).toEqual([
      { text: "3db4b35", code: true },
    ]);
  });

  it("keeps a link target, http(s) only", () => {
    expect(parseTelegramHtml('<a href="https://x.dev/y">+3 more</a>')).toEqual([
      { text: "+3 more", href: "https://x.dev/y" },
    ]);
  });

  it("merges nested emphasis rather than losing it", () => {
    expect(parseTelegramHtml("<b>a<code>b</code>c</b>")).toEqual([
      { text: "a", bold: true },
      { text: "b", bold: true, code: true },
      { text: "c", bold: true },
    ]);
  });

  it("drops unknown tags but keeps their text", () => {
    expect(plainText("<blockquote>quoted</blockquote><u>under</u>")).toBe("quotedunder");
  });

  it("survives malformed markup without throwing", () => {
    expect(plainText("unclosed <b>bold to the end")).toBe("unclosed bold to the end");
    expect(plainText("stray </b> close")).toBe("stray  close");
    // A body cut off mid-tag must not leak a half-written "<b".
    expect(plainText("ok then <b")).toBe("ok then ");
  });

  // The whole point of not using dangerouslySetInnerHTML: content that only
  // *looks* like markup stays text.
  it("never parses escaped user content as a tag", () => {
    const body = "repo &lt;script&gt;alert(1)&lt;/script&gt; pushed";
    expect(plainText(body)).toBe("repo <script>alert(1)</script> pushed");
    const spans = parseTelegramHtml(body);
    expect(spans.every((s) => !s.bold && !s.code && !s.href)).toBe(true);
  });
});

describe("decodeEntities", () => {
  it("decodes the named entities escapeHtml produces", () => {
    expect(decodeEntities("a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;")).toBe(
      'a <b> & "c" \'d\'',
    );
  });

  it("decodes numeric and hex references", () => {
    expect(decodeEntities("&#65;&#x42;")).toBe("AB");
  });

  it("decodes &amp; last so a double-escape survives", () => {
    // "&amp;lt;" was a literal "&lt;" in the source, not a "<".
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  it("leaves text with no entities untouched", () => {
    expect(decodeEntities("plain text")).toBe("plain text");
  });
});

describe("trimSpans", () => {
  it("caps by rendered length and never splits markup", () => {
    const spans = trimSpans(parseTelegramHtml("<b>aaaa</b>bbbb"), 6);
    expect(spans).toEqual([{ text: "aaaa", bold: true }, { text: "bb…" }]);
    // Re-emitting is still well-formed HTML: the ellipsis is interior text.
    expect(spansToHtml(spans)).toBe("<b>aaaa</b>bb…");
  });

  it("keeps everything under the cap", () => {
    const spans = parseTelegramHtml("<code>short</code>");
    expect(trimSpans(spans, 280)).toEqual(spans);
  });
});

describe("spansToHtml", () => {
  it("re-escapes decoded text so nothing re-enters as markup", () => {
    const spans = parseTelegramHtml("&lt;img src=x onerror=1&gt;");
    expect(spansToHtml(spans)).toBe("&lt;img src=x onerror=1&gt;");
  });

  it("refuses a javascript: href", () => {
    const spans = parseTelegramHtml('<a href="javascript:alert(1)">click</a>');
    expect(spansToHtml(spans)).toBe("click");
  });

  it("round-trips the observed body into Word-safe HTML", () => {
    const html = spansToHtml(trimSpans(parseTelegramHtml(OBSERVED), 280));
    expect(html).toContain("<b>mohd-Affan16/Cloud-ai</b>");
    expect(html).toContain("<code>3db4b35</code>");
    // The old code did escapeHtml(body), which *rendered* the tags as text.
    expect(html).not.toContain("&lt;b&gt;");
    expect(html).not.toContain("&lt;code&gt;");
  });
});

describe("plainText", () => {
  it("respects the cap", () => {
    expect(plainText("<b>abcdefghij</b>", 4)).toBe("abcd…");
  });
});
