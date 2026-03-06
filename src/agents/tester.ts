import type { TesterPlanningRequest, TesterPlanningResult } from "./types.js";

const dedupe = (values: readonly string[]): string[] =>
  Array.from(new Set(values));

export class TesterSubagent {
  async plan(request: TesterPlanningRequest): Promise<TesterPlanningResult> {
    const handoff = request.handoff;

    const commands = dedupe([
      "pnpm typecheck",
      "pnpm lint",
      "pnpm test",
      "pnpm test:e2e",
      "pnpm build",
      ...handoff.filePaths.map((filePath) => `pnpm test -- ${filePath}`),
    ]).slice(0, 10);

    const expectedChecks = dedupe([
      "TypeScript compilation has zero errors.",
      "Linting has zero errors.",
      "Unit and integration test suites pass.",
      "Build artifacts are generated successfully.",
      ...handoff.domains.map((domain) => `Domain checks pass for ${domain}.`),
    ]).slice(0, 12);

    return {
      summary: `Tester scaffold prepared verification plan for: ${handoff.query}`,
      commands,
      expectedChecks,
      failureHandling: [
        "Capture failing command output with stack traces and exit code.",
        "Isolate failure to file-level scope before retrying full suite.",
        "Escalate blocking failures to reviewer/verifier handoffs.",
      ],
    };
  }
}
