import { Effect } from "effect";
import type {
	ReviewWorkRepository,
	ReviewWorkUnit,
} from "../repositories/review-work.repository.js";

export interface ReviewUnitTask<Value, Failure> {
	readonly run: (unit: ReviewWorkUnit) => Effect.Effect<Value, Failure>;
	readonly encode: (value: Value) => string;
	readonly decode: (json: string) => Value;
	readonly split: (unit: ReviewWorkUnit, error: Failure) => readonly string[] | null;
}

/** Leaves own checkpoints. Splitting commits parent retirement and children atomically. */
export class ReviewWorkExecutor {
	constructor(
		private readonly repository: ReviewWorkRepository,
		private readonly concurrency: number,
	) {}

	execute<Value, Failure>(
		units: readonly ReviewWorkUnit[],
		task: ReviewUnitTask<Value, Failure>,
	): Effect.Effect<readonly Value[], Failure> {
		return Effect.forEach(units, (unit) => this.executeUnit(unit, task), {
			concurrency: this.concurrency,
		}).pipe(Effect.map((results) => results.flat()));
	}
	private executeUnit<Value, Failure>(
		unit: ReviewWorkUnit,
		task: ReviewUnitTask<Value, Failure>,
	): Effect.Effect<readonly Value[], Failure> {
		if (unit.status === "completed")
			return Effect.sync(() => [task.decode(requireResult(unit))]);
		return Effect.gen({ self: this }, function* () {
			yield* Effect.sync(() => this.repository.claim(unit));
			return yield* task.run(unit).pipe(
				Effect.map((value) => {
					this.repository.complete(unit, task.encode(value));
					return [value];
				}),
				Effect.catch((error) => {
					const children = task.split(unit, error);
					if (children === null) return Effect.fail(error);
					const created = this.repository.split(unit, children);
					// Each parent holds one outer slot, so nested subdivisions remain sequential.
					return Effect.forEach(created, (child) => this.executeUnit(child, task), {
						concurrency: 1,
					}).pipe(Effect.map((results) => results.flat()));
				}),
			);
		});
	}
}
function requireResult(unit: ReviewWorkUnit): string {
	if (unit.resultJson === null)
		throw new Error("Completed review unit is missing its checkpoint.");
	return unit.resultJson;
}
