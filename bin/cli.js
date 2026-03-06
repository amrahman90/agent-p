#!/usr/bin/env node

import("../dist/src/cli.js")
  .then((module) => module.runCli(process.argv))
  .catch((error) => {
    process.stderr.write(`agent-p failed to start: ${String(error)}\n`);
    process.exitCode = 1;
  });
