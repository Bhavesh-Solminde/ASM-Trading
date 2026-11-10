// Serve only the packaged demo, so embeds run from a normal local web origin.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const html = new URL("../chart-comparison.html", import.meta.url);
const port = 4177;
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname;
  if (path !== "/" && path !== "/chart-comparison.html") {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const content = await readFile(html);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(content);
  } catch {
    response.writeHead(500).end("Build the demo first: node demos/chart-comparison/build-demo.mjs");
  }
});
server.on("error", error => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Check the existing preview at http://127.0.0.1:${port}/chart-comparison.html` : error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`Chart comparison: http://127.0.0.1:${port}/chart-comparison.html\nKeep this preview running while comparing the charts.`));
