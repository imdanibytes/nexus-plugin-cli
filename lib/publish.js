"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { validate } = require("./validate");
const { isInteractive } = require("./args");
const { createInterface, ask, multiSelect } = require("./prompts");

const REGISTRY_OWNER = "imdanibytes";
const REGISTRY_REPO = "registry";
const REGISTRY_FILE = "registry.json";

const CATEGORIES = [
  "productivity",
  "developer-tools",
  "monitoring",
  "automation",
  "fun",
  "utilities",
  "ai",
  "security",
];

function exec(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function execSafe(cmd) {
  try {
    return { ok: true, output: exec(cmd) };
  } catch (err) {
    return { ok: false, output: err.stderr || err.message };
  }
}

function parseCategories(val) {
  if (!val) return [];
  return String(val)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function publish(args = {}) {
  const ci = !isInteractive();
  const log = ci ? () => {} : (msg) => console.log(msg);

  log("\n  \x1b[1mnexus-plugin publish\x1b[0m — Publish to the community registry\n");

  // 1. Validate
  log("  Step 1: Validating manifest...\n");
  const ok = validate(".", { json: ci });
  if (!ok) {
    console.error(ci ? '{"error":"validation_failed"}' : "  \x1b[31mFix validation errors before publishing.\x1b[0m\n");
    process.exit(1);
  }

  // 2. Read manifest
  const manifestPath = path.resolve("plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // 3. Check gh CLI
  log("  Step 2: Checking GitHub CLI...\n");
  const ghCheck = execSafe("gh auth status");
  if (!ghCheck.ok) {
    const msg = "GitHub CLI (gh) is not installed or not authenticated.";
    if (ci) {
      console.error(JSON.stringify({ error: "gh_auth_failed", message: msg }));
    } else {
      console.error(`  \x1b[31m${msg}\x1b[0m`);
      console.error("  Install: https://cli.github.com");
      console.error("  Then run: gh auth login\n");
    }
    process.exit(1);
  }
  log(`  \x1b[32m\u2714\x1b[0m gh authenticated\n`);

  // 4. Fork registry (idempotent)
  log("  Step 3: Ensuring registry fork...\n");
  execSafe(`gh repo fork ${REGISTRY_OWNER}/${REGISTRY_REPO} --clone=false`);
  log(`  \x1b[32m\u2714\x1b[0m Fork ready\n`);

  // 5. Current user
  const ghUser = exec("gh api user --jq .login");

  // 6. Fetch current registry.json
  log("  Step 4: Fetching current registry...\n");
  let registryRaw;
  try {
    registryRaw = exec(
      `gh api repos/${ghUser}/${REGISTRY_REPO}/contents/${REGISTRY_FILE} --jq .content | base64 -d`
    );
  } catch {
    registryRaw = exec(
      `gh api repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/${REGISTRY_FILE} --jq .content | base64 -d`
    );
  }

  const registry = JSON.parse(registryRaw);

  // 7. Duplicate check
  const existing = registry.plugins.find((p) => p.id === manifest.id);
  if (existing) {
    const msg = `Plugin "${manifest.id}" already exists in the registry.`;
    if (ci) {
      console.error(JSON.stringify({ error: "duplicate_id", message: msg, id: manifest.id }));
    } else {
      console.error(`  \x1b[31m${msg}\x1b[0m`);
      console.error("  If you're updating, bump the version and update the existing entry.\n");
    }
    process.exit(1);
  }

  // 8. Get manifest URL and categories (flags or prompts)
  let manifestUrl;
  let categories;

  if (args["manifest-url"]) {
    manifestUrl = args["manifest-url"];
    categories = parseCategories(args.categories);
    if (categories.length === 0) categories = ["utilities"];
  } else if (ci) {
    console.error(
      ci
        ? JSON.stringify({ error: "missing_flags", message: "--manifest-url is required in non-interactive mode" })
        : ""
    );
    process.exit(1);
  } else {
    const rl = createInterface();
    try {
      const defaultSlug = manifest.id.split(".").pop();
      manifestUrl = await ask(
        rl,
        "Raw GitHub URL to your plugin.json",
        `https://raw.githubusercontent.com/${ghUser}/nexus-plugin-${defaultSlug}/main/plugin.json`
      );
      categories = await multiSelect(rl, "Categories:", CATEGORIES);
      if (categories.length === 0) categories = ["utilities"];
    } finally {
      rl.close();
    }
  }

  // 9. Build entry
  const entry = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    image: manifest.image,
    manifest_url: manifestUrl,
    categories,
    downloads: 0,
  };

  registry.plugins.push(entry);
  registry.updated_at = new Date().toISOString();

  const updatedJson = JSON.stringify(registry, null, 2) + "\n";
  const updatedBase64 = Buffer.from(updatedJson).toString("base64");

  // 10. Create branch on fork
  const branch = `add-${manifest.id.replace(/\./g, "-")}`;
  log(`\n  Step 5: Creating branch "${branch}" on fork...\n`);

  const defaultSha = exec(
    `gh api repos/${ghUser}/${REGISTRY_REPO}/git/ref/heads/main --jq .object.sha`
  );
  execSafe(
    `gh api repos/${ghUser}/${REGISTRY_REPO}/git/refs -f ref=refs/heads/${branch} -f sha=${defaultSha}`
  );

  // 11. File SHA for update
  let fileSha;
  try {
    fileSha = exec(
      `gh api repos/${ghUser}/${REGISTRY_REPO}/contents/${REGISTRY_FILE}?ref=${branch} --jq .sha`
    );
  } catch {
    fileSha = exec(
      `gh api repos/${ghUser}/${REGISTRY_REPO}/contents/${REGISTRY_FILE} --jq .sha`
    );
  }

  // 12. Commit
  log("  Step 6: Committing registry update...\n");
  exec(
    `gh api repos/${ghUser}/${REGISTRY_REPO}/contents/${REGISTRY_FILE} ` +
      `-X PUT ` +
      `-f message="Add plugin: ${manifest.name}" ` +
      `-f content="${updatedBase64}" ` +
      `-f sha="${fileSha}" ` +
      `-f branch="${branch}"`
  );

  // 13. Open PR
  log("  Step 7: Opening pull request...\n");
  const prUrl = exec(
    `gh pr create ` +
      `--repo ${REGISTRY_OWNER}/${REGISTRY_REPO} ` +
      `--head ${ghUser}:${branch} ` +
      `--title "Add plugin: ${manifest.name}" ` +
      `--body "Adds **${manifest.name}** (${manifest.id}) to the community registry.\n\n` +
      `- Image: \\\`${manifest.image}\\\`\n` +
      `- Version: ${manifest.version}\n` +
      `- Manifest: ${manifestUrl}\n\n` +
      `Submitted via \\\`nexus-plugin publish\\\`"`
  );

  if (ci) {
    console.log(JSON.stringify({ ok: true, pr_url: prUrl, branch, id: manifest.id }));
  } else {
    console.log(`  \x1b[32mPull request created!\x1b[0m`);
    console.log(`  ${prUrl}\n`);
  }
}

module.exports = { publish };
