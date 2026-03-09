import { z } from "zod";

/**
 * Input parameters for evaluation.
 * @example
 * ```typescript
 * const input: EvaluationInput = {
 *   trustScore: 0.85,
 *   successRate: 0.92,
 *   activationAccuracy: 0.95,
 *   averageLatencyMs: 150,
 *   retryRate: 0.05
 * };
 * ```
 */
export const evaluationInputSchema = z.object({
  trustScore: z.number().min(0).max(1),
  successRate: z.number().min(0).max(1),
  activationAccuracy: z.number().min(0).max(1).default(1),
  averageLatencyMs: z.number().nonnegative().default(0),
  retryRate: z.number().min(0).max(1).default(0),
});

export const evaluationResultSchema = z.object({
  overallScore: z.number().min(0).max(1),
  grade: z.enum(["A", "B", "C", "D"]),
  components: z.object({
    trustScore: z.number().min(0).max(1),
    successRate: z.number().min(0).max(1),
    activationAccuracy: z.number().min(0).max(1),
    latencyScore: z.number().min(0).max(1),
    retryPenalty: z.number().min(0).max(1),
  }),
  recommendations: z.array(z.string().min(1)),
});

export type EvaluationInput = z.output<typeof evaluationInputSchema>;
export type EvaluationResult = z.output<typeof evaluationResultSchema>;
