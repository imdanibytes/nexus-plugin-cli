"use strict";

const fs = require("fs");
const path = require("path");

// ── Constants (mirror manifest.rs) ─────────────────────────────

const VALID_PERMISSIONS = [
  "system:info",
  "filesystem:read",
  "filesystem:write",
  "process:list",
  "docker:read",
  "docker:manage",
  "network:local",
  "network:internet",
];

const BIDI_CHARS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const TOOL_NAME_RE = /^[a-z0-9_]{1,100}$/;
const EXT_ID_RE = /^[a-z0-9_-]{1,100}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const VALID_SETTING_TYPES = ["string", "number", "boolean", "select"];

// ── Output helpers ─────────────────────────────────────────────

const PASS = "\x1b[32m\u2714\x1b[0m";
const FAIL = "\x1b[31m\u2718\x1b[0m";
const WARN_SYM = "\x1b[33m\u26A0\x1b[0m";

// ── Validator ──────────────────────────────────────────────────

function validate(target, opts = {}) {
  const jsonMode = opts.json === true;

  const dir = path.resolve(target);
  let manifestPath;
  try {
    manifestPath = fs.statSync(dir).isDirectory()
      ? path.join(dir, "plugin.json")
      : dir;
  } catch {
    manifestPath = path.join(dir, "plugin.json");
  }

  const results = []; // { level: "pass"|"fail"|"warn", msg: string }
  let errors = 0;
  let warnings = 0;

  function pass(msg) {
    results.push({ level: "pass", msg });
  }
  function fail(msg) {
    results.push({ level: "fail", msg });
    errors++;
  }
  function warn(msg) {
    results.push({ level: "warn", msg });
    warnings++;
  }

  function check(condition, passMsg, failMsg) {
    if (condition) pass(passMsg);
    else fail(failMsg);
  }

  // ── Read & parse ─────────────────────────────────────────

  if (!fs.existsSync(manifestPath)) {
    fail("plugin.json not found");
    return output(manifestPath, results, errors, warnings, jsonMode);
  }

  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (err) {
    fail(`Cannot read plugin.json: ${err.message}`);
    return output(manifestPath, results, errors, warnings, jsonMode);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    fail(`Invalid JSON: ${err.message}`);
    return output(manifestPath, results, errors, warnings, jsonMode);
  }

  // ── Required fields ──────────────────────────────────────

  check(
    manifest.id && typeof manifest.id === "string" && manifest.id.length > 0,
    "id present",
    "id is required"
  );
  check(
    manifest.name && typeof manifest.name === "string" && manifest.name.length > 0,
    "name present",
    "name is required"
  );
  check(
    manifest.version && typeof manifest.version === "string" && manifest.version.length > 0,
    "version present",
    "version is required"
  );
  check(
    manifest.description && typeof manifest.description === "string" && manifest.description.length > 0,
    "description present",
    "description is required"
  );
  check(
    manifest.author && typeof manifest.author === "string",
    "author present",
    "author is required"
  );
  check(
    manifest.image && typeof manifest.image === "string" && manifest.image.length > 0,
    "image present",
    "image is required"
  );
  check(
    manifest.ui && typeof manifest.ui.port === "number" && manifest.ui.port > 0,
    `ui.port = ${manifest.ui?.port}`,
    "ui.port must be a non-zero number"
  );

  // ── Length limits ────────────────────────────────────────

  if (manifest.id) check(manifest.id.length <= 100, "id length ok", `id too long (${manifest.id.length}/100)`);
  if (manifest.name) check(manifest.name.length <= 100, "name length ok", `name too long (${manifest.name.length}/100)`);
  if (manifest.version) check(manifest.version.length <= 50, "version length ok", `version too long (${manifest.version.length}/50)`);
  if (manifest.description) check(manifest.description.length <= 2000, "description length ok", `description too long (${manifest.description.length}/2000)`);
  if (manifest.author) check(manifest.author.length <= 100, "author length ok", `author too long (${manifest.author.length}/100)`);
  if (manifest.image) check(manifest.image.length <= 200, "image length ok", `image too long (${manifest.image.length}/200)`);

  // ── Bidi characters ──────────────────────────────────────

  const bidiFields = { name: manifest.name, description: manifest.description, author: manifest.author };
  let bidiClean = true;
  for (const [field, value] of Object.entries(bidiFields)) {
    if (value && BIDI_CHARS.test(value)) {
      fail(`${field} contains bidirectional override characters`);
      bidiClean = false;
    }
  }
  if (bidiClean) pass("no bidi override characters");

  // ── Icon URL ─────────────────────────────────────────────

  if (manifest.icon != null) {
    check(
      typeof manifest.icon === "string" &&
        (manifest.icon.startsWith("http://") || manifest.icon.startsWith("https://")),
      "icon URL valid",
      "icon must be an http or https URL"
    );
  }

  // ── Image digest ─────────────────────────────────────────

  if (manifest.image_digest != null) {
    check(
      DIGEST_RE.test(manifest.image_digest),
      "image_digest format valid",
      'image_digest must be "sha256:" followed by 64 hex characters'
    );
  }

  // ── Permissions ──────────────────────────────────────────

  if (Array.isArray(manifest.permissions)) {
    let permsOk = true;
    for (const perm of manifest.permissions) {
      if (!VALID_PERMISSIONS.includes(perm) && !perm.startsWith("ext:")) {
        fail(`invalid permission: "${perm}"`);
        permsOk = false;
      }
    }
    if (permsOk) pass(`permissions valid (${manifest.permissions.length})`);
  }

  // ── MCP tools ────────────────────────────────────────────

  if (manifest.mcp && Array.isArray(manifest.mcp.tools)) {
    const toolNames = new Set();
    let toolsOk = true;

    for (const tool of manifest.mcp.tools) {
      if (!TOOL_NAME_RE.test(tool.name)) {
        fail(`MCP tool name "${tool.name}" invalid (must be [a-z0-9_], 1-100 chars)`);
        toolsOk = false;
        continue;
      }
      if (toolNames.has(tool.name)) {
        fail(`duplicate MCP tool name: "${tool.name}"`);
        toolsOk = false;
        continue;
      }
      toolNames.add(tool.name);

      if (!tool.description || tool.description.length === 0) {
        fail(`MCP tool "${tool.name}" must have a description`);
        toolsOk = false;
      } else if (tool.description.length > 2000) {
        fail(`MCP tool "${tool.name}" description exceeds 2000 characters`);
        toolsOk = false;
      } else if (BIDI_CHARS.test(tool.description)) {
        fail(`MCP tool "${tool.name}" description contains bidi overrides`);
        toolsOk = false;
      }

      if (!tool.input_schema || typeof tool.input_schema !== "object" || tool.input_schema.type !== "object") {
        fail(`MCP tool "${tool.name}" input_schema must have "type": "object" at root`);
        toolsOk = false;
      }

      if (Array.isArray(tool.permissions)) {
        for (const perm of tool.permissions) {
          if (!VALID_PERMISSIONS.includes(perm) && !perm.startsWith("ext:")) {
            fail(`MCP tool "${tool.name}" has invalid permission: "${perm}"`);
            toolsOk = false;
          }
        }
      }
    }

    if (toolsOk) pass(`MCP tools valid (${manifest.mcp.tools.length})`);
  }

  // ── Extensions ───────────────────────────────────────────

  if (manifest.extensions && typeof manifest.extensions === "object") {
    let extsOk = true;
    const entries = Object.entries(manifest.extensions);

    for (const [extId, operations] of entries) {
      if (!EXT_ID_RE.test(extId)) {
        fail(`extension ID "${extId}" must match [a-z0-9_-], 1-100 chars`);
        extsOk = false;
        continue;
      }
      if (!Array.isArray(operations) || operations.length === 0) {
        fail(`extension "${extId}" must declare at least one operation`);
        extsOk = false;
        continue;
      }
      for (const op of operations) {
        if (!EXT_ID_RE.test(op)) {
          fail(`extension "${extId}" operation "${op}" must match [a-z0-9_-], 1-100 chars`);
          extsOk = false;
        }
      }
    }

    if (extsOk && entries.length > 0) pass(`extensions valid (${entries.length})`);
  }

  // ── Settings ─────────────────────────────────────────────

  if (Array.isArray(manifest.settings)) {
    let settingsOk = true;

    for (const setting of manifest.settings) {
      if (!setting.key || typeof setting.key !== "string") {
        fail("setting missing key");
        settingsOk = false;
        continue;
      }
      if (!VALID_SETTING_TYPES.includes(setting.type)) {
        fail(`setting "${setting.key}" has invalid type "${setting.type}" (must be ${VALID_SETTING_TYPES.join("/")})`);
        settingsOk = false;
      }
      if (setting.type === "select" && (!Array.isArray(setting.options) || setting.options.length === 0)) {
        fail(`setting "${setting.key}" type "select" requires a non-empty options array`);
        settingsOk = false;
      }
    }

    if (settingsOk && manifest.settings.length > 0) pass(`settings valid (${manifest.settings.length})`);
  }

  // ── Dockerfile warning ───────────────────────────────────

  const manifestDir = path.dirname(manifestPath);
  const dockerfilePath = path.join(manifestDir, "Dockerfile");
  if (!fs.existsSync(dockerfilePath)) {
    warn("no Dockerfile found next to plugin.json");
  } else {
    pass("Dockerfile found");
  }

  // ── Output ───────────────────────────────────────────────

  return output(manifestPath, results, errors, warnings, jsonMode);
}

function output(manifestPath, results, errors, warnings, jsonMode) {
  if (jsonMode) {
    const obj = {
      file: manifestPath,
      ok: errors === 0,
      errors,
      warnings,
      results: results.map((r) => ({ level: r.level, message: r.msg })),
    };
    console.log(JSON.stringify(obj));
    return errors === 0;
  }

  // Human-readable output
  console.log(`\n  Validating ${path.relative(process.cwd(), manifestPath) || manifestPath}\n`);
  for (const r of results) {
    if (r.level === "pass") console.log(`  ${PASS} ${r.msg}`);
    else if (r.level === "fail") console.log(`  ${FAIL} ${r.msg}`);
    else console.log(`  ${WARN_SYM} ${r.msg}`);
  }

  console.log("");
  if (errors === 0) {
    console.log(`  \x1b[32mValidation passed\x1b[0m${warnings > 0 ? ` with ${warnings} warning(s)` : ""}\n`);
  } else {
    console.log(`  \x1b[31m${errors} error(s)\x1b[0m${warnings > 0 ? `, ${warnings} warning(s)` : ""}\n`);
  }

  return errors === 0;
}

module.exports = { validate };
