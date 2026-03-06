import type { BuilderPlanningRequest, BuilderPlanningResult } from "./types.js";

const dedupe = (values: readonly string[]): string[] =>
  Array.from(new Set(values));

export class BuilderSubagent {
  async plan(request: BuilderPlanningRequest): Promise<BuilderPlanningResult> {
    const handoff = request.handoff;
    const plannedChanges = dedupe([
      ...handoff.filePaths,
      ...handoff.domains.map((domain) => `domain:${domain}`),
    ]).slice(0, 10);

    return {
      summary: `Builder scaffold prepared implementation plan for: ${handoff.query}`,
      plannedChanges,
      risks: [
        "Builder implementation remains scaffolded and does not modify files yet.",
      ],
    };
  }
}
