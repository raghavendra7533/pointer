import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = import.meta.dirname;
const VENDOR = {
  "/vendor/react.js": join(dirname(require.resolve("react/package.json")), "umd/react.development.js"),
  "/vendor/react-dom.js": join(dirname(require.resolve("react-dom/package.json")), "umd/react-dom.development.js"),
  "/vendor/vue.js": join(dirname(require.resolve("vue/package.json")), "dist/vue.global.js"),
};

/** Static server for the fixture pages, on 127.0.0.1 only. */
export function serveFixtures(port = 0) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const file = VENDOR[path] ?? (/^\/[\w-]+\.html$/.test(path) ? join(here, "fixtures", path) : null);
    if (!file) return res.writeHead(404).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html" : "text/javascript" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await serveFixtures(Number(process.env.PORT) || 4173);
  console.log(`Fixtures on http://127.0.0.1:${port}/vanilla.html`);
}
