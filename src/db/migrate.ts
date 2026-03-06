import { runMigrations } from "./migration-runner.js";

const main = async (): Promise<void> => {
  const result = await runMigrations();
  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      applied: result.applied,
      skipped: result.skipped,
    })}\n`,
  );
};

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown migration failure";
  process.stderr.write(`Migration failed: ${message}\n`);
  process.exitCode = 1;
});
