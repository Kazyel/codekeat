export interface ModelCatalogEntry {
	readonly id: string;
	readonly displayName: string;
	readonly apiName: string;
	readonly inputNanoUsdPerToken: number;
	readonly cachedInputNanoUsdPerToken: number;
	readonly outputNanoUsdPerToken: number;
	readonly enabled: boolean;
	readonly selected: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface ReviewModelConfiguration {
	readonly id: string;
	readonly apiName: string;
	readonly inputNanoUsdPerToken: number;
	readonly cachedInputNanoUsdPerToken: number;
	readonly outputNanoUsdPerToken: number;
}

export interface CreateModelInput {
	readonly displayName: string;
	readonly apiName: string;
	readonly inputNanoUsdPerToken: number;
	readonly cachedInputNanoUsdPerToken: number;
	readonly outputNanoUsdPerToken: number;
	readonly enabled: boolean;
}

export interface UpdateModelInput {
	readonly displayName?: string;
	readonly apiName?: string;
	readonly inputNanoUsdPerToken?: number;
	readonly cachedInputNanoUsdPerToken?: number;
	readonly outputNanoUsdPerToken?: number;
	readonly enabled?: boolean;
}

export type UpdateModelResult = "updated" | "not_found" | "duplicate" | "selected";
export type SelectModelResult = "selected" | "not_found" | "disabled";
