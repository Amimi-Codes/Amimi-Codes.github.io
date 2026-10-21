const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const file = path.resolve(
      root,
      "." + pathname,
      pathname.endsWith("/") ? "index.html" : "",
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    // like GitHub Pages: /about serves about.html, /projects redirects to /projects/
    const html = path.extname(file) ? file : file + ".html";
    if (!path.extname(file) && !fs.existsSync(html) && fs.existsSync(path.join(file, "index.html"))) {
      res.writeHead(301, { Location: pathname + "/" }).end();
      return;
    }
    fs.readFile(fs.existsSync(file) && !fs.statSync(file).isDirectory() ? file : html, (error, data) => {
      if (error) {
        res.writeHead(404).end("Not found");
        return;
      }
      res
        .writeHead(200, {
          "Content-Type":
            mime[path.extname(file)] || (path.extname(file) ? undefined : mime[".html"]) || "application/octet-stream",
        })
        .end(data);
    });
  })
  .listen(4173, "127.0.0.1", () =>
    console.log("Local preview: http://127.0.0.1:4173"),
  );
