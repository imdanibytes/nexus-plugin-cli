"use strict";

const readline = require("readline");

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/** Ask a single question, return the answer (or default). */
function ask(rl, question, defaultValue) {
  const suffix = defaultValue != null ? ` \x1b[2m(${defaultValue})\x1b[0m` : "";
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || (defaultValue != null ? String(defaultValue) : ""));
    });
  });
}

/** Multi-select from a list. Returns array of selected values. */
function multiSelect(rl, question, options) {
  return new Promise((resolve) => {
    console.log(`\n  ${question}`);
    options.forEach((opt, i) => {
      console.log(`    \x1b[2m${i + 1})\x1b[0m ${opt}`);
    });
    console.log(`    \x1b[2m0)\x1b[0m None`);
    rl.question("  Select (comma-separated numbers): ", (answer) => {
      if (!answer.trim() || answer.trim() === "0") {
        resolve([]);
        return;
      }
      const indices = answer
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((i) => i >= 0 && i < options.length);
      resolve([...new Set(indices.map((i) => options[i]))]);
    });
  });
}

/** Yes/no question. Returns boolean. */
function confirm(rl, question, defaultYes = false) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`  ${question} \x1b[2m(${hint})\x1b[0m: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) {
        resolve(defaultYes);
        return;
      }
      resolve(a === "y" || a === "yes");
    });
  });
}

module.exports = { createInterface, ask, multiSelect, confirm };
