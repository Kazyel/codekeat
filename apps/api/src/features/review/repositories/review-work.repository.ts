import { createHash, randomUUID } from "node:crypto";
import {
	reviewRuns,
	reviewUsageEvents,
	reviewWorkPlans,
	reviewWorkUnits,
	type DatabaseConnection,
} from "@codekeat/database";
import { and, asc, eq, sql } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { currentTimestamp } from "#shared/database";
import type { ReviewUsageEvent } from "../types/review-input.types.js";

const unitSchema = z
	.object({
		id: z.string(),
		reviewRunId: z.string(),
		stage: z.enum(["review", "judge"]),
		parentId: z.string().nullable(),
		status: z.enum(["pending", "running", "completed", "split"]),
		ordinal: z.number().int().nonnegative(),
		payloadJson: z.string(),
		resultJson: z.string().nullable(),
		updatedAt: z.string(),
	})
	.strict();
export type ReviewWorkUnit = z.infer<typeof unitSchema>;
const usageSchema = z
	.object({
		stage: z.enum(["review", "judge"]),
		callId: z.string().min(1),
		stepNumber: z.number().int().nonnegative(),
		usage: z
			.object({
				inputTokens: z.number().int().nonnegative(),
				outputTokens: z.number().int().nonnegative(),
				cacheTokens: z.number().int().nonnegative(),
				costUsdMicros: z.number().nonnegative(),
			})
			.strict()
			.refine((value) => value.cacheTokens <= value.inputTokens),
	})
	.strict();

export class ReviewWorkRepository {
	constructor(private readonly connection: DatabaseConnection) {}

	ensurePlan(runId: string, fingerprint: string): void {
		this.connection.db.transaction((transaction) => {
			const existing = transaction
				.select()
				.from(reviewWorkPlans)
				.where(eq(reviewWorkPlans.reviewRunId, runId))
				.get();
			if (existing?.fingerprint === fingerprint) return;
			transaction.delete(reviewWorkUnits).where(eq(reviewWorkUnits.reviewRunId, runId)).run();
			transaction
				.insert(reviewWorkPlans)
				.values({ reviewRunId: runId, fingerprint, createdAt: currentTimestamp() })
				.onConflictDoUpdate({
					target: reviewWorkPlans.reviewRunId,
					set: { fingerprint, createdAt: currentTimestamp() },
				})
				.run();
		});
	}
	ensureUnits(runId: string, stage: ReviewWorkUnit["stage"], payloads: readonly string[]): void {
		this.connection.db.transaction(() => {
			if (this.listLeaves(runId, stage).length > 0) return;
			for (const [ordinal, payloadJson] of payloads.entries())
				this.insertUnit(runId, stage, payloadJson, ordinal, null);
		});
	}
	listLeaves(runId: string, stage: ReviewWorkUnit["stage"]): readonly ReviewWorkUnit[] {
		return z.array(unitSchema).parse(
			this.connection.db
				.select()
				.from(reviewWorkUnits)
				.where(
					and(
						eq(reviewWorkUnits.reviewRunId, runId),
						eq(reviewWorkUnits.stage, stage),
						sql`${reviewWorkUnits.status} != 'split'`,
					),
				)
				.orderBy(asc(reviewWorkUnits.ordinal), asc(reviewWorkUnits.id))
				.all(),
		);
	}
	claim(unit: ReviewWorkUnit): void {
		const result = this.connection.db
			.update(reviewWorkUnits)
			.set({ status: "running", updatedAt: currentTimestamp() })
			.where(and(eq(reviewWorkUnits.id, unit.id), eq(reviewWorkUnits.status, "pending")))
			.run();
		if (result.changes !== 1) throw new Error("Review unit is not available for claim.");
	}
	complete(unit: ReviewWorkUnit, resultJson: string): void {
		const result = this.connection.db
			.update(reviewWorkUnits)
			.set({ status: "completed", resultJson, updatedAt: currentTimestamp() })
			.where(and(eq(reviewWorkUnits.id, unit.id), eq(reviewWorkUnits.status, "running")))
			.run();
		if (result.changes !== 1) throw new Error("Review unit completion lost its claim.");
	}
	resetInterrupted(runId: string): void {
		this.connection.db
			.update(reviewWorkUnits)
			.set({ status: "pending", updatedAt: currentTimestamp() })
			.where(
				and(eq(reviewWorkUnits.reviewRunId, runId), eq(reviewWorkUnits.status, "running")),
			)
			.run();
	}
	split(unit: ReviewWorkUnit, payloads: readonly string[]): readonly ReviewWorkUnit[] {
		if (payloads.length < 2)
			throw new Error("Splitting a review unit requires complete child coverage.");
		this.connection.db.transaction((transaction) => {
			const last = transaction
				.select({ value: sql<number>`coalesce(max(${reviewWorkUnits.ordinal}),0)` })
				.from(reviewWorkUnits)
				.where(
					and(
						eq(reviewWorkUnits.reviewRunId, unit.reviewRunId),
						eq(reviewWorkUnits.stage, unit.stage),
					),
				)
				.get();
			for (const [offset, payloadJson] of payloads.entries())
				this.insertUnit(
					unit.reviewRunId,
					unit.stage,
					payloadJson,
					(last?.value ?? 0) + offset + 1,
					unit.id,
				);
			transaction
				.update(reviewWorkUnits)
				.set({ status: "split", updatedAt: currentTimestamp() })
				.where(eq(reviewWorkUnits.id, unit.id))
				.run();
		});
		return this.listLeaves(unit.reviewRunId, unit.stage).filter(
			(child) => child.parentId === unit.id,
		);
	}
	/** Receipt and aggregate are committed together so a restart cannot lose paid usage. */
	recordUsage(runId: string, event: ReviewUsageEvent): boolean {
		const parsed = usageSchema.parse(event);
		return this.connection.db.transaction((transaction) => {
			const prior = transaction
				.select()
				.from(reviewUsageEvents)
				.where(
					and(
						eq(reviewUsageEvents.reviewRunId, runId),
						eq(reviewUsageEvents.stage, parsed.stage),
						eq(reviewUsageEvents.callId, parsed.callId),
						eq(reviewUsageEvents.stepNumber, parsed.stepNumber),
					),
				)
				.get();
			if (prior !== undefined) return verifyDuplicateUsage(prior, parsed);
			const firstCall =
				transaction
					.select({ id: reviewUsageEvents.id })
					.from(reviewUsageEvents)
					.where(
						and(
							eq(reviewUsageEvents.reviewRunId, runId),
							eq(reviewUsageEvents.stage, parsed.stage),
							eq(reviewUsageEvents.callId, parsed.callId),
						),
					)
					.get() === undefined;
			transaction
				.insert(reviewUsageEvents)
				.values({
					id: randomUUID(),
					reviewRunId: runId,
					...parsed.usage,
					stage: parsed.stage,
					callId: parsed.callId,
					stepNumber: parsed.stepNumber,
					createdAt: currentTimestamp(),
				})
				.run();
			const columns = usageColumns(parsed, firstCall);
			transaction.update(reviewRuns).set(columns).where(eq(reviewRuns.id, runId)).run();
			return true;
		});
	}
	private insertUnit(
		runId: string,
		stage: ReviewWorkUnit["stage"],
		payloadJson: string,
		ordinal: number,
		parentId: string | null,
	): void {
		const id = createHash("sha256")
			.update(JSON.stringify([runId, stage, parentId, ordinal, payloadJson]))
			.digest("hex");
		this.connection.db
			.insert(reviewWorkUnits)
			.values({
				id,
				reviewRunId: runId,
				stage,
				parentId,
				ordinal,
				payloadJson,
				status: "pending",
				resultJson: null,
				updatedAt: currentTimestamp(),
			})
			.onConflictDoNothing()
			.run();
	}
}
function verifyDuplicateUsage(
	prior: typeof reviewUsageEvents.$inferSelect,
	event: ReviewUsageEvent,
): false {
	if (
		prior.inputTokens !== event.usage.inputTokens ||
		prior.outputTokens !== event.usage.outputTokens ||
		prior.cacheTokens !== event.usage.cacheTokens ||
		prior.costUsdMicros !== event.usage.costUsdMicros
	)
		throw new Error("Provider usage receipt changed after it was persisted.");
	return false;
}
function usageColumns(
	event: ReviewUsageEvent,
	firstCall: boolean,
): SQLiteUpdateSetSource<typeof reviewRuns> {
	const { inputTokens, outputTokens, cacheTokens } = event.usage;
	const { input, output, cached } = tokenColumns(event.stage);
	const totals = {
		inputTokens: sql`coalesce(${input},0)+${inputTokens}`,
		outputTokens: sql`coalesce(${output},0)+${outputTokens}`,
		cacheTokens: sql`coalesce(${cached},0)+${cacheTokens}`,
	};
	const cost = sql`round(((coalesce(${input},0)+${inputTokens}-coalesce(${cached},0)-${cacheTokens})*${reviewRuns.modelInputNanoUsdPerToken}+(coalesce(${cached},0)+${cacheTokens})*${reviewRuns.modelCachedInputNanoUsdPerToken}+(coalesce(${output},0)+${outputTokens})*${reviewRuns.modelOutputNanoUsdPerToken})/1000.0)`;
	if (event.stage === "review")
		return { ...totals, costUsdMicros: cost, updatedAt: currentTimestamp() };
	return {
		judgeInputTokens: totals.inputTokens,
		judgeOutputTokens: totals.outputTokens,
		judgeCacheTokens: totals.cacheTokens,
		judgeCostUsdMicros: cost,
		judgeCallCount: sql`coalesce(${reviewRuns.judgeCallCount},0)+${firstCall ? 1 : 0}`,
		updatedAt: currentTimestamp(),
	};
}

function tokenColumns(stage: ReviewUsageEvent["stage"]): {
	input: typeof reviewRuns.inputTokens | typeof reviewRuns.judgeInputTokens;
	output: typeof reviewRuns.outputTokens | typeof reviewRuns.judgeOutputTokens;
	cached: typeof reviewRuns.cacheTokens | typeof reviewRuns.judgeCacheTokens;
} {
	if (stage === "review")
		return {
			input: reviewRuns.inputTokens,
			output: reviewRuns.outputTokens,
			cached: reviewRuns.cacheTokens,
		};
	return {
		input: reviewRuns.judgeInputTokens,
		output: reviewRuns.judgeOutputTokens,
		cached: reviewRuns.judgeCacheTokens,
	};
}
