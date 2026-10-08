// Bundles the eval runner and the answer-key audit (TypeScript + workspace packages) into evals/dist/*.mjs.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(dir, "run.ts"), path.join(dir, "audit.ts")],
  outdir: path.join(dir, "dist"),
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  bundle: true,
  logLevel: "warning",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
