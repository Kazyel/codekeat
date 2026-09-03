import { models, type DatabaseConnection } from "@codekeat/database";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { currentTimestamp } from "#shared/database";
import type {
	CreateModelInput,
	ModelCatalogEntry,
	ReviewModelConfiguration,
	SelectModelResult,
	UpdateModelInput,
	UpdateModelResult,
} from "../types/model-catalog.types.js";

export class ModelCatalogRepository {
	constructor(private readonly connection: DatabaseConnection) {}

	listModels(): readonly ModelCatalogEntry[] {
		return this.connection.db
			.select()
			.from(models)
			.orderBy(desc(models.selected), asc(models.displayName))
			.all();
	}

	findSelectedModel(): ReviewModelConfiguration | null {
		return (
			this.connection.db
				.select({
					id: models.id,
					apiName: models.apiName,
					inputNanoUsdPerToken: models.inputNanoUsdPerToken,
					cachedInputNanoUsdPerToken: models.cachedInputNanoUsdPerToken,
					outputNanoUsdPerToken: models.outputNanoUsdPerToken,
				})
				.from(models)
				.where(and(eq(models.selected, true), eq(models.enabled, true)))
				.get() ?? null
		);
	}

	createModel(input: CreateModelInput): ModelCatalogEntry | null {
		const now = currentTimestamp();
		const model: ModelCatalogEntry = {
			id: randomUUID(),
			...input,
			selected: false,
			createdAt: now,
			updatedAt: now,
		};
		const result = this.connection.db
			.insert(models)
			.values(model)
			.onConflictDoNothing({ target: models.apiName })
			.run();

		return result.changes === 0 ? null : model;
	}

	updateModel(id: string, input: UpdateModelInput): UpdateModelResult {
		return this.connection.db.transaction((transaction) => {
			const existing = transaction.select().from(models).where(eq(models.id, id)).get();
			if (existing === undefined) {
				return "not_found";
			}
			if (disablesSelectedModel(existing.selected, input.enabled)) {
				return "selected";
			}
			const duplicate = transaction
				.select({ id: models.id })
				.from(models)
				.where(
					and(eq(models.apiName, input.apiName ?? existing.apiName), ne(models.id, id)),
				)
				.get();
			if (duplicate !== undefined) {
				return "duplicate";
			}

			transaction
				.update(models)
				.set({ ...input, updatedAt: currentTimestamp() })
				.where(eq(models.id, id))
				.run();
			return "updated";
		});
	}

	selectModel(id: string): SelectModelResult {
		return this.connection.db.transaction((transaction) => {
			const model = transaction.select().from(models).where(eq(models.id, id)).get();
			if (model === undefined) {
				return "not_found";
			}
			if (!model.enabled) {
				return "disabled";
			}

			const now = currentTimestamp();
			transaction
				.update(models)
				.set({ selected: false, updatedAt: now })
				.where(eq(models.selected, true))
				.run();
			transaction
				.update(models)
				.set({ selected: true, updatedAt: now })
				.where(eq(models.id, id))
				.run();
			return "selected";
		});
	}
}

function disablesSelectedModel(selected: boolean, enabled: boolean | undefined): boolean {
	return selected && enabled === false;
}
