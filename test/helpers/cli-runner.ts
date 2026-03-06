import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliRunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, "../..");

export const runCliCommand = (
  args: readonly string[],
  options: CliRunOptions = {},
): Promise<CliRunResult> => {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const cwd = options.cwd ?? workspaceRoot;

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--eval",
        "import('./src/cli.ts').then((m) => m.runCli(process.argv)).catch((error) => { process.stderr.write(`${String(error)}\\n`); process.exitCode = 1; });",
        "agent-p",
        ...args,
      ],
      {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      rejectRun(error);
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectRun(
        new Error(
          `CLI command timed out after ${timeoutMs}ms: ${args.join(" ")}`,
        ),
      );
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolveRun({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
};
