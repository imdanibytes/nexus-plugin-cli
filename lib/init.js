"use strict";

const fs = require("fs");
const path = require("path");
const { isInteractive } = require("./args");
const { createInterface, ask, multiSelect, confirm } = require("./prompts");

const pluginJsonTpl = require("./templates/plugin.json.js");
const dockerfileTpl = require("./templates/Dockerfile.js");
const serverJsTpl = require("./templates/server.js.js");
const indexHtmlTpl = require("./templates/index.html.js");
const gitignoreTpl = require("./templates/gitignore.js");
const dockerWorkflowTpl = require("./templates/docker-workflow.js");

const PERMISSIONS = [
  "system:info",
  "filesystem:read",
  "filesystem:write",
  "process:list",
  "docker:read",
  "docker:manage",
  "network:local",
  "network:internet",
];

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  if (typeof val === "boolean") return val;
  return val === "true" || val === "1" || val === "yes";
}

function parsePermissions(val) {
  if (!val || val === "none") return [];
  return String(val)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function init(args = {}) {
  const ci = !isInteractive();

  let name, author, description, port, permissions, includeMcp, includeSettings, id, slug, outDir;

  if (args.name) {
    // Flag-driven mode (CI or explicit flags)
    name = args.name;
    author = args.author || "";
    description = args.description || "A Nexus plugin";
    port = parseInt(args.port, 10) || 80;
    permissions = parsePermissions(args.permissions);
    includeMcp = toBool(args.mcp, true);
    includeSettings = toBool(args.settings, true);
    slug = slugify(name);
    const authorSlug = author.toLowerCase().replace(/[^a-z0-9]+/g, "") || "author";
    id = args.id || `com.${authorSlug}.${slug}`;
    outDir = args.out || slug;
  } else if (ci) {
    console.error("\x1b[31mError:\x1b[0m --name is required in non-interactive mode.");
    console.error("Usage: nexus-plugin init --name 'My Plugin' --author 'me' [--port 80] [--permissions system:info,network:local] [--mcp true] [--settings true]");
    process.exit(1);
  } else {
    // Interactive mode
    console.log("\n  \x1b[1mnexus-plugin init\x1b[0m — Scaffold a new plugin\n");

    const rl = createInterface();
    try {
      name = await ask(rl, "Plugin name", "My Plugin");
      author = await ask(rl, "Author name");
      description = await ask(rl, "Description", "A Nexus plugin");
      const portStr = await ask(rl, "UI port", 80);
      port = parseInt(portStr, 10) || 80;

      slug = slugify(name);
      const authorSlug = author.toLowerCase().replace(/[^a-z0-9]+/g, "") || "author";
      id = `com.${authorSlug}.${slug}`;
      console.log(`\n  \x1b[2mPlugin ID: ${id}\x1b[0m`);

      permissions = await multiSelect(rl, "Permissions:", PERMISSIONS);
      includeMcp = await confirm(rl, "Include MCP tools skeleton?", true);
      includeSettings = await confirm(rl, "Include settings skeleton?", true);
      outDir = slug;
    } finally {
      rl.close();
    }
  }

  const config = {
    id,
    name,
    slug,
    author,
    description,
    port,
    permissions,
    includeMcp,
    includeSettings,
  };

  // Create directory structure
  const dir = path.resolve(outDir);
  if (fs.existsSync(dir)) {
    console.error(`\x1b[31mError:\x1b[0m Directory "${outDir}" already exists.`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(dir, "src", "public"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });

  const files = {
    "plugin.json": pluginJsonTpl(config),
    Dockerfile: dockerfileTpl(config),
    ".gitignore": gitignoreTpl(),
    "src/server.js": serverJsTpl(config),
    "src/public/index.html": indexHtmlTpl(config),
    ".github/workflows/docker.yml": dockerWorkflowTpl(config),
  };

  for (const [filePath, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, filePath), content);
  }

  if (ci) {
    // Machine-friendly output
    console.log(JSON.stringify({ dir: outDir, id, files: Object.keys(files) }));
  } else {
    console.log(`\n  \x1b[32mCreated plugin in ./${outDir}/\x1b[0m\n`);
    console.log("  Files:");
    for (const f of Object.keys(files)) console.log(`    ${f}`);
    const ghUser = author.toLowerCase().replace(/[^a-z0-9-]/g, "");
    console.log(`
  Next steps:
    cd ${outDir}
    nexus-plugin validate
    docker build -t ghcr.io/${ghUser}/nexus-plugin-${slug}:0.1.0 .
    docker push ghcr.io/${ghUser}/nexus-plugin-${slug}:0.1.0
    nexus-plugin publish
`);
  }
}

module.exports = { init };
