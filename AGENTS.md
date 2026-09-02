# Agent Instructions

## Scope

- Codekeat is a pnpm/Turborepo monorepo for an AI-assisted GitHub PR reviewer.
- Reviews are advisory only; never create blocking checks or prevent merges without explicit approval.

## Repository Map

| Path                         | Responsibility                                                     |
| ---------------------------- | ------------------------------------------------------------------ |
| `apps/api`                   | Probot GitHub App, review orchestration, and external integrations |
| `apps/web`                   | Next.js interface                                                  |
| `packages/database`          | Drizzle persistence over SQLite                                    |
| `packages/typescript-config` | Shared strict TypeScript configuration                             |

## Commands

Use pnpm 10 with Node.js 24; never use npm or yarn and never edit `pnpm-lock.yaml` manually.

| Task                    | Command                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| Install                 | `pnpm install --frozen-lockfile`                                              |
| Develop all workspaces  | `pnpm dev`                                                                    |
| Develop API only        | `pnpm dev:api`                                                                |
| Check one file          | `pnpm exec oxlint path/to/file.ts && pnpm exec oxfmt --check path/to/file.ts` |
| Test one API file       | `pnpm --filter @codekeat/api exec vitest run path/to/file.test.ts`            |
| Typecheck one workspace | `pnpm --filter <workspace-name> typecheck`                                    |
| Full verification       | `pnpm check && pnpm typecheck && pnpm test && pnpm build`                     |
| Validate Compose        | `pnpm docker:config`                                                          |
| Validate environments   | `pnpm env:check`                                                              |
| Generate migration      | `pnpm --filter @codekeat/database db:generate`                                |
| Open Drizzle Studio     | `pnpm db:studio`                                                              |

## Change Flow

1. Read the target package manifest, related types, tests, and one existing analogous implementation.
2. State a short plan for multi-file work; surface conflicting or missing requirements before coding.
3. Implement the smallest complete change and keep refactoring separate from new behavior.
4. Add or update behavior-focused tests for every behavior change and bug fix.
5. Run the narrowest relevant checks while iterating, then full verification before completion.
6. Review the diff for correctness, simplicity, architecture, security, performance, and dead code.

## Type and Boundary Rules

- Keep TypeScript strict; exported contracts and function boundaries must have explicit concrete types.
- `any`, `as any`, `@ts-ignore`, double assertions, and casts used to silence errors are forbidden.
- Use `unknown` only at untrusted external boundaries or catch clauses; validate or narrow it immediately.
- Parse GitHub, Gemini, HTTP, environment, and persisted input with Zod before application logic.
- Do not let `unknown` escape an adapter or appear in domain/application interfaces.
- Model valid states explicitly with discriminated unions; avoid optional fields and boolean flags that permit invalid states.
- Handle unions exhaustively and make error outcomes explicit; do not silently fall back.

## Simplicity Rules

- Prefer guard clauses and linear flows; do not use nested ternaries or add branches to unrelated flows.
- Keep cyclomatic complexity at most 5 per function; split orchestration from decisions before exceeding it.
- Give each function and module one responsibility, with names that state domain intent.
- Introduce an abstraction only when concrete duplication or real variation exists; remove pass-through layers.
- Prefer existing platform and repository capabilities; justify every new dependency before adding it.
- Keep PRs focused; split work near 300 changed lines and never mix broad cleanup into a feature.

## Safety and Verification

- Treat every external payload as untrusted and never expose secrets in code, logs, fixtures, or commits.
- Do not hand-edit generated migrations; change the schema and run the generation command.
- Preserve the single-API-replica constraint while SQLite backs the API.
- Never claim completion or commit without fresh command output proving the relevant checks passed.
