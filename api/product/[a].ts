import handler from "../../src/vercelFunction.js";

// Depth 1: /api/product/me, /api/product/ops, /api/product/repos.
// Vercel functions match exactly one dynamic segment per bracket, so every
// depth the product API uses gets its own thin file; the router itself is
// shared and reads the real path off the request URL.
export default handler;
