# Hooks Module Documentation (Phase 7 + Phase 8 Governance)

## Goal

Implement a deterministic, platform-neutral hooks core, keep platform-specific behavior in boundary translators for Claude Code and OpenCode plugins, and centralize policy + audit behavior in neutral runtime.

## Sources and alignment

- Claude hooks reference and guide were used for event semantics and decision-control shapes:
  - `https://code.claude.com/docs/en/hooks-guide`
  - `https://code.claude.com/docs/en/hooks`
- OpenCode plugin docs were used for event-hook mapping at plugin boundaries:
  - `https://opencode.ai/docs/plugins/`

## Architecture decision

- Internal runtime contracts are platform-neutral (`session_start`, `pre_tool_use`, `post_tool_use`, `stop`, `notification`).
- Claude/OpenCode differences are isolated in translators.
- Runtime classes never emit platform-specific envelopes directly.

## Implemented runtime scope

- `SessionStartHook` (`src/hooks/session-start.ts`)
- `PreToolUseHook` (`src/hooks/pre-tool-use.ts`)
- `PostToolUseHook` (`src/hooks/post-tool-use.ts`)
- `StopHook` (`src/hooks/stop.ts`)
- `NotificationHook` (`src/hooks/notification.ts`)

All hooks enforce:

- strict Zod validation at execution boundary,
- deterministic timestamps via injectable `now`,
- `executed` vs `skipped` status,
- stable reason codes (`hook_disabled`, `policy_block`, `validation_failed`, `no_action`).

## Neutral contracts

Defined in `src/hooks/types.ts`:

- canonical hook names and status schemas,
- shared reason-code and platform enums,
- payload/context/result schemas for all Phase 7 hooks,
- decision models:
  - PreToolUse: `allow | deny | escalate`
  - PostToolUse: `allow | block`
  - Stop: `allow | block`

## Central policy engine

File: `src/hooks/policy.ts`

- A shared `HookPolicyEngine` now evaluates neutral decisions for all actionable hooks.
- Runtime hooks call policy once and map result into hook result contracts.
- Policy supports extensible governance knobs:
  - profiles: `strict | balanced | permissive`
  - legacy compatibility flag: `strictMode` (migrated to profile semantics)
  - `escalationThreshold`
  - `riskyTools[]`
  - `sensitivePatterns[]`
  - scoped overrides:
    - `hooks.policy.toolOverrides.<toolName>`
    - `hooks.policy.categoryOverrides.<category>`
  - default decisions per hook (`preToolUseDefaultDecision`, `postToolUseDefaultDecision`, `stopDefaultDecision`)

Behavior highlights:

- `pre_tool_use`: blocked patterns still deny in enforce mode; strict profile/mode can escalate risky/sensitive calls.
- `post_tool_use`: block patterns and strict profile/mode sensitive output checks map to deterministic `block` decisions.
- `stop`: completion-signal checks and configurable default stop behavior are handled centrally.
- `notification`: strict profile/mode sensitive notifications can be skipped with policy reason code.
- Category and tool overrides apply in order: base profile -> category override -> tool override.

Policy extensibility completion notes:

- Effective defaults now use `hooks.policy.profile: balanced` in `.agent-p/config.yaml` while retaining `strictMode` for backward compatibility.
- Loader migration remains bidirectional and deterministic for legacy config inputs that still set `strictMode`.
- Test matrix now covers override conflict precedence and permissive-profile behavior with explicit escalation overrides.

## Observability and audit trail

File: `src/hooks/audit.ts`

- Added structured audit events with deterministic metadata:
  - hook, status, platform, sessionId, timestamp, latencyMs
  - decision/reason/reasonCode when available
  - payload/context previews (configurable truncation)
- Added sensitive-field redaction for keys matching token/secret/password/api-key/auth/cookie families.
- Added sinks:
  - `InMemoryHookAuditSink` (default rolling buffer)
  - `JsonlHookAuditSink` (append-only JSONL)

CLI support:

- `hooks:audit-log [--limit N] [--clear]`
- `hooks:config` (prints effective hooks/policy/audit config)
- both governance command outputs are protected by snapshot coverage to keep CLI contracts stable

## Translator boundaries

### Claude translator

File: `src/hooks/translators/claude.ts`

Inbound mapping:

- Claude `SessionStart` input -> neutral `session_start` payload
- Claude `PreToolUse` input -> neutral `pre_tool_use` payload
- Claude `PostToolUse` input -> neutral `post_tool_use` payload
- Claude `Stop` input -> neutral `stop` payload
- Claude `Notification` input -> neutral `notification` payload

Outbound mapping:

- neutral `PreToolUse` -> Claude `hookSpecificOutput.permissionDecision`
- neutral `PostToolUse` and `Stop` block decisions -> Claude top-level `decision: "block"` + `reason`
- neutral context additions -> Claude `hookSpecificOutput.additionalContext` where applicable

### OpenCode translator

File: `src/hooks/translators/opencode.ts`

Implemented OpenCode parity event mappings:

- `session.created` -> neutral `session_start`
- `tool.execute.before` -> neutral `pre_tool_use`
- `tool.execute.after` -> neutral `post_tool_use`
- `session.idle` -> neutral `stop`
- `tui.toast.show` -> neutral `notification`

Outbound mapping returns deterministic plugin-side decision payloads (`action`, `continue`, `updatedInput`, `additionalContext`) without leaking Claude-specific envelopes into core logic.

## CLI integration

`src/cli.ts` includes scaffold command coverage for all hooks:

- `hooks:session-start <sessionId>`
- `hooks:pre-tool-use <sessionId> <toolName>`
- `hooks:post-tool-use <sessionId> <toolName>`
- `hooks:stop <sessionId>`
- `hooks:notification <sessionId> <notificationType> <message>`
- `hooks:config`
- `hooks:audit-log`

Each command supports:

- config-aware enable/disable checks,
- neutral output by default,
- optional output translation via `--platform neutral|claude|opencode`.

## DI and exports

- Tokens in `src/core/container.ts`:
  - `SessionStartHook`, `PreToolUseHook`, `PostToolUseHook`, `StopHook`, `NotificationHook`
- Registrations in `src/core/bootstrap.ts`
- Public exports in `src/hooks/index.ts` and `src/index.ts`

## Configuration

- Hooks config schema includes `notification` toggle in `src/config/schema.ts`.
- Hooks config now includes governance and observability sections:
  - `hooks.policy.*`
  - `hooks.audit.*`
- Backward-compatible config migration in `src/config/load-config.ts` maps between legacy `strictMode` and profile-based policy config.
- Fail-fast validation guards contradictory policy settings (for example strict mode with permissive pre-tool default).
- Default config updated in `.agent-p/config.yaml`.

## Validation and tests

Unit tests:

- `test/unit/hooks-session-start.test.ts`
- `test/unit/hooks-pre-tool-use.test.ts`
- `test/unit/hooks-post-tool-use.test.ts`
- `test/unit/hooks-stop.test.ts`
- `test/unit/hooks-notification.test.ts`
- `test/unit/hooks-translators.test.ts`
- `test/unit/hooks-policy.test.ts`
- `test/unit/hooks-audit.test.ts`

CLI tests:

- existing `test/unit/cli.test.ts` for SessionStart
- `test/unit/cli-hooks.test.ts` for new hook commands and translator output behavior

Integration tests:

- `test/integration/hooks-governance.integration.test.ts`
