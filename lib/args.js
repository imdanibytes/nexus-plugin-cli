"use strict";

// Flags that are always boolean (never consume the next arg as a value)
const BOOLEAN_FLAGS = new Set([
  "json",
  "help",
  "version",
  "h",
  "v",
]);

/**
 * Minimal argv parser. Zero dependencies.
 *
 * Handles:  --key value, --key=value, --flag (boolean true), positionals
 * Returns:  { _: [positionals], key: value, ... }
 */
function parseArgs(argv) {
  const result = { _: [] };
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--") {
      result._.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        result[key] = BOOLEAN_FLAGS.has(key) ? val !== "false" : val;
      } else {
        const key = arg.slice(2);
        if (BOOLEAN_FLAGS.has(key)) {
          result[key] = true;
        } else {
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith("--")) {
            result[key] = next;
            i++;
          } else {
            result[key] = true;
          }
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      result[key] = true;
    } else {
      result._.push(arg);
    }

    i++;
  }

  return result;
}

/** True if stdin is a TTY (interactive terminal). */
function isInteractive() {
  return process.stdin.isTTY === true;
}

module.exports = { parseArgs, isInteractive };
