import { build } from "esbuild";
import { chmodSync, cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export async function buildBridge() {
  await build({
    absWorkingDir: import.meta.dirname,
    entryPoints: ["src/cli.ts"],
    outfile: "dist/cli.js",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    external: ["zod", "@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*"],
    banner: { js: "" },
    logLevel: "warning",
  });
  chmodSync(join(import.meta.dirname, "dist/cli.js"), 0o755);
  // Ship the built extension inside the package so `pointer setup` can unpack it.
  const ext = join(import.meta.dirname, "../extension/dist");
  const target = join(import.meta.dirname, "dist/extension");
  rmSync(target, { recursive: true, force: true });
  if (existsSync(join(ext, "manifest.json"))) cpSync(ext, target, { recursive: true });
}

if (import.meta.url === `file://${process.argv[1]}`) await buildBridge();
