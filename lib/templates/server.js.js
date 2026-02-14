"use strict";

module.exports = function serverJs(config) {
  const mcpHandler = config.includeMcp
    ? `
  // MCP tool call handler
  if (req.method === "POST" && req.url === "/mcp/call") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { tool_name, arguments: args = {} } = JSON.parse(body);
        let result;

        switch (tool_name) {
          case "example_tool": {
            result = {
              content: [
                { type: "text", text: \`Received: \${args.message || "(empty)"}\` },
              ],
              is_error: false,
            };
            break;
          }
          default:
            result = {
              content: [{ type: "text", text: \`Unknown tool: \${tool_name}\` }],
              is_error: true,
            };
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            content: [{ type: "text", text: \`Error: \${err.message}\` }],
            is_error: true,
          })
        );
      }
    });
    return;
  }
`
    : "";

  return `const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = ${config.port};
const NEXUS_PLUGIN_SECRET = process.env.NEXUS_PLUGIN_SECRET || "";
const NEXUS_API_URL =
  process.env.NEXUS_API_URL || "http://host.docker.internal:9600";
const NEXUS_HOST_URL =
  process.env.NEXUS_HOST_URL || "http://host.docker.internal:9600";

const publicDir = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// ── Token Management ───────────────────────────────────────────

let cachedAccessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 30000) {
    return cachedAccessToken;
  }

  const res = await fetch(\`\${NEXUS_HOST_URL}/api/v1/auth/token\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: NEXUS_PLUGIN_SECRET }),
  });

  if (!res.ok) {
    throw new Error(\`Token exchange failed: \${res.status}\`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedAccessToken;
}

// ── Server ─────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Config endpoint (frontend gets access token + API URL)
  if (req.url === "/api/config") {
    getAccessToken()
      .then((token) => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ token, apiUrl: NEXUS_API_URL }));
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }
${mcpHandler}
  // Serve index.html with NEXUS_API_URL templated in
  if (req.url === "/" || req.url === "/index.html") {
    const html = fs
      .readFileSync(path.join(publicDir, "index.html"), "utf8")
      .replace(/\\{\\{NEXUS_API_URL\\}\\}/g, NEXUS_API_URL);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // Static file server
  const fullPath = path.join(publicDir, req.url);
  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(\`${config.name} plugin running on port \${PORT}\`);
});
`;
};
