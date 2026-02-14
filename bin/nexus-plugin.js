#!/usr/bin/env node

"use strict";

const { parseArgs } = require("../lib/args");

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

const HELP = `
  nexus-plugin — Developer CLI for Nexus plugins

  Usage:
    nexus-plugin <command> [options]

  Commands:
    init              Scaffold a new plugin project
    validate [path]   Validate a plugin manifest
    publish           Publish plugin to the community registry

  Global Options:
    --help, -h        Show this help message
    --version, -v     Show version

  init Options:
    --name            Plugin display name
    --author          Author name
    --description     Plugin description
    --port            UI port (default: 80)
    --permissions     Comma-separated permissions
    --mcp             Include MCP tools skeleton (true/false)
    --settings        Include settings skeleton (true/false)
    --id              Override auto-generated plugin ID
    --out             Output directory (default: derived from name)

  validate Options:
    --json            Output results as JSON (for CI parsing)

  publish Options:
    --manifest-url    Raw URL to plugin.json (skips prompt)
    --categories      Comma-separated categories (skips prompt)
`;

if (!command || command === "--help" || command === "-h" || args.help || args.h) {
  console.log(HELP);
  process.exit(0);
}

if (command === "--version" || command === "-v" || args.version || args.v) {
  const pkg = require("../package.json");
  console.log(pkg.version);
  process.exit(0);
}

async function main() {
  switch (command) {
    case "init": {
      const { init } = require("../lib/init");
      await init(args);
      break;
    }
    case "validate": {
      const { validate } = require("../lib/validate");
      const target = args._[1] || ".";
      const ok = validate(target, { json: !!args.json });
      process.exit(ok ? 0 : 1);
      break;
    }
    case "publish": {
      const { publish } = require("../lib/publish");
      await publish(args);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n\x1b[31mFatal:\x1b[0m ${err.message}`);
  process.exit(1);
});
