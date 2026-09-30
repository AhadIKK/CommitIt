// scan() runs BEFORE summarize() on every commit, on the raw diff.
// On match: report file path only, skip file in LLM payload, store
// secret_flag=true. Never log/store secret values or full source.

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "aws_key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "github_token", re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "private_key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "generic_secret", re: /(api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]{8,}['"]/i },
];

export type ScanHit = { file: string; rule: string };
export type ScanResult = { hasSecret: boolean; hits: ScanHit[] };

export function scan(files: { path: string; content: string }[]): ScanResult {
  const hits: ScanHit[] = [];
  for (const f of files) {
    for (const p of PATTERNS) {
      if (p.re.test(f.content)) {
        hits.push({ file: f.path, rule: p.name });
        break; // one hit per file is enough; path only, never the value
      }
    }
  }
  return { hasSecret: hits.length > 0, hits };
}
