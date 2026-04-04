import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const port = 8080;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
};

createServer(async (req, res) => {
  let path = req.url.split("?")[0];

  // Rewrite /join/* to /join.html
  if (path.startsWith("/join")) {
    path = "/join.html";
  }

  if (path === "/") path = "/index.html";

  const ext = path.slice(path.lastIndexOf("."));
  try {
    const data = await readFile(join(dir, path));
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/html" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Local web server: http://0.0.0.0:${port}`);
});
