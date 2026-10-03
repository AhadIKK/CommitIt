// Seeded author avatars (algorithmic-art, scoped to the approved job):
// deterministic identicons — same login always renders the same pattern.
// Pattern varies per author; colors stay on CSS tokens so both themes apply.
// Pure functions, no dependencies.

// FNV-1a 32-bit hash of the login → stable seed.
export function hashLogin(login: string): number {
  let h = 2166136261;
  for (let i = 0; i < login.length; i++) {
    h ^= login.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 5×5 left-right mirrored grid, row-major. Guarantees ≥1 filled cell.
export function avatarCells(login: string, size = 5): boolean[] {
  const rand = mulberry32(hashLogin(login || "unknown"));
  const half = Math.ceil(size / 2);
  const cells: boolean[] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < half; c++) row.push(rand() > 0.5);
    cells.push(...row, ...row.slice(0, size - half).reverse());
  }
  if (!cells.some(Boolean)) cells[Math.floor(cells.length / 2)] = true;
  return cells;
}
