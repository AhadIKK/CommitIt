// classify(): conventional-commit fast path, else heuristic for vague msgs.
// Pure function; tested against terrible-messages fixture.

const TYPES = [
  "feat",
  "fix",
  "docs",
  "refactor",
  "test",
  "chore",
  "merge",
  "perf",
  "ci",
  "build",
] as const;
export type Category = (typeof TYPES)[number] | "other";

const CONVENTIONAL_RE = /^(\w+)(?:\([^)]*\))?(!)?:\s*.+/;

const HEURISTICS: { re: RegExp; cat: Category }[] = [
  { re: /merg/i, cat: "merge" },
  { re: /fix|bug|patch|hotfix|resolve/i, cat: "fix" },
  { re: /feat|add|implement|support/i, cat: "feat" },
  { re: /doc|readme|comment/i, cat: "docs" },
  { re: /refactor|clean|rename/i, cat: "refactor" },
  { re: /test|spec|cover/i, cat: "test" },
  { re: /perf|speed|optim/i, cat: "perf" },
  { re: /ci|pipeline|workflow|action/i, cat: "ci" },
  { re: /updat|bump|wip|misc|stuff|change/i, cat: "chore" },
];

export function classify(message: string): Category {
  const first = message.split("\n")[0] ?? "";
  const m = CONVENTIONAL_RE.exec(first.trim());
  if (m) {
    const t = m[1]?.toLowerCase() as Category;
    if ((TYPES as readonly string[]).includes(t)) return t;
  }
  for (const h of HEURISTICS) {
    if (h.re.test(first)) return h.cat;
  }
  return "other";
}
