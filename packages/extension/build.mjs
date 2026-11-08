import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

const root = import.meta.dirname;
const dist = join(root, "dist");
const e2e = process.env["POINTER_E2E"] === "1";

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "icons"), { recursive: true });

const common = { absWorkingDir: root, bundle: true, target: "chrome116", logLevel: "warning", minify: !e2e, define: { "process.env.POINTER_E2E": JSON.stringify(e2e ? "1" : "0") } };
await build({ ...common, entryPoints: { background: "src/background.ts" }, outdir: dist, format: "esm" });
await build({ ...common, entryPoints: { content: "src/content.ts", page: "src/page/page.ts", options: "src/options.ts", explain: "src/explain.ts" }, outdir: dist, format: "iife" });

cpSync(join(root, "static", "options.html"), join(dist, "options.html"));
cpSync(join(root, "static", "explain.html"), join(dist, "explain.html"));
writeFileSync(join(dist, "manifest.json"), readFileSync(join(root, "static", "manifest.json")));

// Dependency-free PNG icons: a blue rounded square with a white cursor arrow.
function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
      const inCorner = cx < r && cy < r && Math.hypot(r - cx - 0.5, r - cy - 0.5) > r;
      if (inCorner) continue;
      const u = x / size, v = y / size;
      // arrow: triangle (0.28,0.2) (0.28,0.78) (0.7,0.56) approx, plus a tail
      const inArrow = u > 0.28 && u < 0.72 && v > 0.2 && v < 0.8 && v > 0.2 + (u - 0.28) * 0.85 * 0.0 && v < 0.2 + (0.72 - u) * 0.0 + 0.6 - (u - 0.28) * 0.35 && v > 0.2 + (u - 0.28) * 0.9;
      const c = inArrow ? [255, 255, 255] : [37, 99, 235];
      raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(join(dist, "icons", `${s}.png`), icon(s));
