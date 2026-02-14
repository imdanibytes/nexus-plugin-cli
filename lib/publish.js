"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { validate } = require("./validate");
const { isInteractive } = require("./args");
const { createInterface, ask, multiSelect } = require("./prompts");

const REGISTRY_OWNER = "imdanibytes";
const REGISTRY_REPO = "registry";

const CATEGORIES = [
  "productivity",
  "developer-tools",
  "monitoring",
  "automation",
  "fun",
  "utilities",
  "ai",
  "ai-tools",
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

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Fetch the manifest from a URL and compute its SHA-256 hash.
 */
function fetchManifestHash(url) {
  const content = exec(`curl -sfL --max-time 15 "${url}"`);
  return { content, hash: sha256(content) };
}

/**
 * Get the Docker image digest by inspecting local or pulling.
 */
function getImageDigest(image) {
  // Try local Docker inspect first
  const local = execSafe(
    `docker inspect --format '{{index .RepoDigests 0}}' "${image}" 2>/dev/null`
  );
  if (local.ok && local.output.includes("sha256:")) {
    const match = local.output.match(/sha256:[0-9a-f]{64}/);
    if (match) return match[0];
  }

  // Try pulling and inspecting
  const pull = execSafe(`docker pull "${image}" 2>/dev/null`);
  if (pull.ok) {
    const inspect = execSafe(
      `docker inspect --format '{{index .RepoDigests 0}}' "${image}" 2>/dev/null`
    );
    if (inspect.ok && inspect.output.includes("sha256:")) {
      const match = inspect.output.match(/sha256:[0-9a-f]{64}/);
      if (match) return match[0];
    }
  }

  return null;
}

/**
 * Build a YAML string for the v2 registry plugin entry.
 */
function buildPluginYaml(entry) {
  const lines = [];
  lines.push(`author: ${entry.author}`);
  if (entry.author_url) lines.push(`author_url: ${entry.author_url}`);
  lines.push(`categories:`);
  for (const cat of entry.categories) {
    lines.push(`- ${cat}`);
  }
  lines.push(`created_at: ${entry.created_at}`);
  lines.push(`description: ${yamlString(entry.description)}`);
  lines.push(`homepage: ${entry.homepage}`);
  lines.push(`id: ${entry.id}`);
  lines.push(`image: ${entry.image}`);
  lines.push(`image_digest: "${entry.image_digest}"`);
  lines.push(`license: ${entry.license}`);
  lines.push(`manifest_sha256: ${entry.manifest_sha256}`);
  lines.push(`manifest_url: ${entry.manifest_url}`);
  lines.push(`name: ${yamlString(entry.name)}`);
  lines.push(`status: ${entry.status}`);
  lines.push(`version: "${entry.version}"`);
  lines.push("");
  return lines.join("\n");
}

function yamlString(str) {
  if (!str) return '""';
  if (/[:#\[\]{}&*!|>'"%@`]/.test(str) || str.includes("\n")) {
    return JSON.stringify(str);
  }
  return str;
}

/**
 * Fetch the existing YAML for a plugin from the registry (if it exists).
 * Returns { exists, content, sha } or { exists: false }.
 */
function fetchExistingEntry(yamlFile) {
  const result = execSafe(
    `gh api repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/${yamlFile} --jq '.content' 2>/dev/null`
  );
  if (!result.ok || !result.output) return { exists: false };

  try {
    const content = Buffer.from(result.output, "base64").toString("utf8");

    // Also get the git blob SHA (needed to update the file via API)
    const shaResult = execSafe(
      `gh api repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/${yamlFile} --jq '.sha'`
    );

    // Parse created_at from existing YAML
    const createdAtMatch = content.match(/^created_at:\s*(.+)$/m);
    const categoriesMatch = content.match(/^categories:\n((?:- .+\n)+)/m);
    let categories = [];
    if (categoriesMatch) {
      categories = categoriesMatch[1]
        .split("\n")
        .filter(Boolean)
        .map((l) => l.replace(/^- /, "").trim());
    }

    return {
      exists: true,
      content,
      sha: shaResult.ok ? shaResult.output : null,
      created_at: createdAtMatch ? createdAtMatch[1].trim() : null,
      categories,
    };
  } catch {
    return { exists: false };
  }
}

async function publish(args = {}) {
  const ci = !isInteractive();
  const log = ci ? () => {} : (msg) => console.log(msg);

  log("\n  \x1b[1mnexus-plugin publish\x1b[0m — Publish to the community registry\n");

  // ── Step 1: Validate manifest ──────────────────────────────────

  log("  Step 1: Validating manifest...\n");
  const ok = validate(".", { json: ci });
  if (!ok) {
    console.error(ci ? '{"error":"validation_failed"}' : "  \x1b[31mFix validation errors before publishing.\x1b[0m\n");
    process.exit(1);
  }

  // ── Step 2: Read manifest ──────────────────────────────────────

  const manifestPath = path.resolve("plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // ── Step 3: Check gh CLI ───────────────────────────────────────

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

  // ── Step 4: Fork registry ──────────────────────────────────────

  log("  Step 3: Ensuring registry fork...\n");
  execSafe(`gh repo fork ${REGISTRY_OWNER}/${REGISTRY_REPO} --clone=false`);
  log(`  \x1b[32m\u2714\x1b[0m Fork ready\n`);

  const ghUser = exec("gh api user --jq .login");

  // ── Step 5: Check for existing entry ───────────────────────────

  log("  Step 4: Checking registry...\n");
  const yamlFile = `plugins/${manifest.id}.yaml`;
  const existing = fetchExistingEntry(yamlFile);
  const isUpdate = existing.exists;

  if (isUpdate) {
    log(`  \x1b[33m\u2794\x1b[0m Existing entry found — this will be a version update\n`);
  } else {
    log(`  \x1b[32m\u2714\x1b[0m New plugin\n`);
  }

  // ── Step 6: Gather metadata ────────────────────────────────────

  let manifestUrl;
  let categories;

  if (args["manifest-url"]) {
    manifestUrl = args["manifest-url"];
    categories = parseCategories(args.categories);
    if (categories.length === 0) {
      categories = isUpdate && existing.categories.length > 0
        ? existing.categories
        : ["utilities"];
    }
  } else if (ci) {
    console.error(
      JSON.stringify({ error: "missing_flags", message: "--manifest-url is required in non-interactive mode" })
    );
    process.exit(1);
  } else {
    const rl = createInterface();
    try {
      const defaultSlug = manifest.id.split(".").pop();
      manifestUrl = await ask(
        rl,
        "Raw GitHub URL to your plugin.json",
        `https://raw.githubusercontent.com/${ghUser}/nexus-${defaultSlug}/main/plugin.json`
      );
      if (isUpdate && existing.categories.length > 0) {
        categories = existing.categories;
        log(`  Using existing categories: ${categories.join(", ")}\n`);
      } else {
        categories = await multiSelect(rl, "Categories:", CATEGORIES);
        if (categories.length === 0) categories = ["utilities"];
      }
    } finally {
      rl.close();
    }
  }

  // ── Step 7: Compute manifest SHA-256 (required) ────────────────

  log("  Step 5: Computing manifest hash...\n");
  let manifestSha256;
  try {
    const { hash } = fetchManifestHash(manifestUrl);
    manifestSha256 = hash;
    log(`  \x1b[32m\u2714\x1b[0m manifest_sha256: ${hash.slice(0, 16)}...\n`);
  } catch (err) {
    const msg = `Could not fetch manifest from ${manifestUrl}: ${err.message}`;
    if (ci) {
      console.error(JSON.stringify({ error: "manifest_fetch_failed", message: msg }));
    } else {
      console.error(`  \x1b[31m\u2718\x1b[0m ${msg}`);
      console.error("  Make sure the manifest URL is correct and publicly accessible.\n");
    }
    process.exit(1);
  }

  // ── Step 8: Get Docker image digest (required) ─────────────────

  log("  Step 6: Resolving Docker image digest...\n");
  const imageDigest = getImageDigest(manifest.image);
  if (imageDigest) {
    log(`  \x1b[32m\u2714\x1b[0m image_digest: ${imageDigest.slice(0, 23)}...\n`);
  } else {
    const msg = `Could not resolve digest for ${manifest.image}. The image must be built and pushed before publishing.`;
    if (ci) {
      console.error(JSON.stringify({ error: "image_digest_unavailable", message: msg }));
    } else {
      console.error(`  \x1b[31m\u2718\x1b[0m ${msg}`);
      console.error("  Push your image first, then re-run publish.\n");
    }
    process.exit(1);
  }

  // ── Step 9: Build YAML entry ───────────────────────────────────

  const entry = {
    author: manifest.author || ghUser,
    author_url: manifest.homepage
      ? manifest.homepage.replace(/\/[^/]+$/, "")
      : `https://github.com/${ghUser}`,
    categories,
    created_at: isUpdate && existing.created_at
      ? existing.created_at
      : new Date().toISOString(),
    description: manifest.description,
    homepage: manifest.homepage || `https://github.com/${ghUser}/nexus-${manifest.id.split(".").pop()}`,
    id: manifest.id,
    image: manifest.image,
    image_digest: imageDigest,
    license: manifest.license || "MIT",
    manifest_sha256: manifestSha256,
    manifest_url: manifestUrl,
    name: manifest.name,
    status: "active",
    version: manifest.version,
  };

  const yamlContent = buildPluginYaml(entry);

  if (!ci) {
    console.log("  \x1b[1mRegistry entry:\x1b[0m\n");
    for (const line of yamlContent.split("\n")) {
      if (line) console.log(`    ${line}`);
    }
    console.log("");
  }

  // ── Step 10: Create branch and commit YAML ─────────────────────

  const action = isUpdate ? "update" : "add";
  const branch = `${action}-${manifest.id.replace(/\./g, "-")}-${manifest.version.replace(/\./g, "-")}`;
  log(`  Step 7: Creating branch "${branch}" on fork...\n`);

  // Sync fork with upstream
  execSafe(`gh repo sync ${ghUser}/${REGISTRY_REPO}`);

  const defaultSha = exec(
    `gh api repos/${ghUser}/${REGISTRY_REPO}/git/ref/heads/main --jq .object.sha`
  );

  // Delete stale branch if it exists
  execSafe(
    `gh api repos/${ghUser}/${REGISTRY_REPO}/git/refs/heads/${branch} -X DELETE 2>/dev/null`
  );

  exec(
    `gh api repos/${ghUser}/${REGISTRY_REPO}/git/refs -f ref=refs/heads/${branch} -f sha=${defaultSha}`
  );

  log(`  \x1b[32m\u2714\x1b[0m Branch created\n`);

  // Commit the YAML file
  log("  Step 8: Committing plugin entry...\n");
  const contentBase64 = Buffer.from(yamlContent).toString("base64");

  const commitMsg = isUpdate
    ? `Update plugins/${manifest.id} to ${manifest.version}`
    : `Add plugins/${manifest.id} ${manifest.version}`;

  // If updating, we need the file SHA on the branch to overwrite
  const putArgs = [
    `gh api repos/${ghUser}/${REGISTRY_REPO}/contents/${yamlFile}`,
    `-X PUT`,
    `-f message="${commitMsg}"`,
    `-f content="${contentBase64}"`,
    `-f branch="${branch}"`,
  ];

  if (isUpdate) {
    // Get the SHA of the file on the branch (just created from main, so same as main)
    const fileSha = exec(
      `gh api repos/${ghUser}/${REGISTRY_REPO}/contents/${yamlFile}?ref=${branch} --jq .sha`
    );
    putArgs.push(`-f sha="${fileSha}"`);
  }

  exec(putArgs.join(" "));
  log(`  \x1b[32m\u2714\x1b[0m Committed ${yamlFile}\n`);

  // ── Step 11: Open PR ───────────────────────────────────────────

  log("  Step 9: Opening pull request...\n");

  const prTitle = isUpdate
    ? `Update plugin: ${manifest.name} ${manifest.version}`
    : `Add plugin: ${manifest.name}`;

  const prDescription = isUpdate ? "Updates" : "Adds";
  const prBody = [
    `${prDescription} **${manifest.name}** (\`${manifest.id}\`) ${isUpdate ? `to v${manifest.version}` : "to the community registry"}.`,
    "",
    `| Field | Value |`,
    `|-------|-------|`,
    `| Image | \`${manifest.image}\` |`,
    `| Version | ${manifest.version} |`,
    `| License | ${entry.license} |`,
    `| Manifest | ${manifestUrl} |`,
    imageDigest ? `| Image Digest | \`${imageDigest.slice(0, 19)}...\` |` : null,
    manifestSha256 ? `| Manifest SHA | \`${manifestSha256.slice(0, 16)}...\` |` : null,
    "",
    `Submitted via \`nexus-plugin publish\``,
  ].filter(Boolean).join("\n");

  // Write body to temp file to avoid shell escaping issues with backticks
  const bodyFile = path.join(os.tmpdir(), `nexus-publish-pr-${Date.now()}.md`);
  fs.writeFileSync(bodyFile, prBody);

  let prUrl;
  try {
    prUrl = exec(
      `gh pr create ` +
        `--repo ${REGISTRY_OWNER}/${REGISTRY_REPO} ` +
        `--head ${ghUser}:${branch} ` +
        `--title "${prTitle}" ` +
        `--body-file "${bodyFile}"`
    );
  } finally {
    try { fs.unlinkSync(bodyFile); } catch {}
  }

  // ── Step 12: Auto-merge (owner only) ──────────────────────────

  if (ghUser === REGISTRY_OWNER) {
    log("  Step 10: Enabling auto-merge...\n");
    execSafe(`gh pr merge --auto --squash --delete-branch "${prUrl}"`);
  }

  // ── Done ───────────────────────────────────────────────────────

  if (ci) {
    console.log(JSON.stringify({
      ok: true,
      pr_url: prUrl,
      branch,
      id: manifest.id,
      version: manifest.version,
      is_update: isUpdate,
      image_digest: imageDigest,
      manifest_sha256: manifestSha256,
    }));
  } else {
    console.log(`  \x1b[32m\u2714 Pull request created!\x1b[0m`);
    console.log(`  ${prUrl}\n`);
  }
}

module.exports = { publish };
