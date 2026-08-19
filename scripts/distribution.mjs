#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installDistribution, inspectDistribution, rollbackDistribution, uninstallDistribution } from "./lib/distribution-lifecycle.mjs";

function parse(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    if (key === "purge") {
      options.purge = true;
      continue;
    }
    const value = rest[++index];
    if (!value || value.startsWith("--")) throw new Error(`A value is required for ${item}.`);
    options[key] = value;
  }
  return { command, options };
}

function usage() {
  return {
    commands: [
      "distribution install [--source <plugin-source>] [--install-root <directory>] [--bin-dir <directory>]",
      "distribution upgrade [--source <plugin-source>] [--install-root <directory>] [--bin-dir <directory>]",
      "distribution status [--install-root <directory>] [--bin-dir <directory>]",
      "distribution doctor [--install-root <directory>] [--bin-dir <directory>]",
      "distribution rollback [--install-root <directory>] [--bin-dir <directory>]",
      "distribution uninstall [--install-root <directory>] [--bin-dir <directory>] [--purge]",
    ],
  };
}

export function runDistributionCommand(argv = process.argv.slice(2)) {
  const { command, options } = parse(argv);
  const common = { installRoot: options["install-root"], binDirectory: options["bin-dir"] };
  if (command === "help" || command === "--help" || command === "-h") return usage();
  if (command === "install" || command === "upgrade") return installDistribution({ ...common, sourceRoot: options.source });
  if (command === "status" || command === "doctor") return inspectDistribution(common);
  if (command === "rollback") return rollbackDistribution(common);
  if (command === "uninstall") return uninstallDistribution({ ...common, purge: options.purge });
  throw new Error(`Unknown distribution command: ${command}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  Promise.resolve().then(() => runDistributionCommand()).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ status: "failed", code: error.code || "HEAD_DISTRIBUTION_ERROR", error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
