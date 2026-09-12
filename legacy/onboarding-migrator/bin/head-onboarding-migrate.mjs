#!/usr/bin/env node
import { applyMigration, inspectMigration } from "../src/migrator.mjs";

const [command, root] = process.argv.slice(2);
if (!new Set(["inspect", "apply"]).has(command) || !root) {
  process.stderr.write("Usage: head-onboarding-migrate <inspect|apply> <project>\n");
  process.exitCode = 2;
} else {
  try {
    const result = command === "inspect" ? inspectMigration({ root }) : applyMigration({ root });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "failed", code: error.code || "ERROR", message: error.message })}\n`);
    process.exitCode = 1;
  }
}
