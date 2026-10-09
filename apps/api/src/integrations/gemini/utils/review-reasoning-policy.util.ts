import type { GoogleLanguageModelOptions } from "@ai-sdk/google";

export type ReviewReasoningPhase = "investigation" | "navigation" | "focused_judge" | "decision";

/** Reduce reasoning only for directed retrieval and the first candidate verification. */
export function reviewReasoningOptions(
	apiName: string,
	phase: ReviewReasoningPhase,
): GoogleLanguageModelOptions {
	const reduced = ["navigation", "focused_judge"].includes(phase);
	const name = apiName.replace(/^models\//, "");
	if (/^gemini-2\.5-(?:pro|flash)(?:-|$)/.test(name))
		return { thinkingConfig: { thinkingBudget: reduced ? 4_096 : -1 } };
	if (/^gemini-3(?:\.[0-9]+)?-(?:flash|pro)(?:-|$)/.test(name))
		return { thinkingConfig: { thinkingLevel: reduced ? reducedLevel(name) : "high" } };
	return {};
}

export function directedNavigation(requestedTools: readonly string[]): boolean {
	return (
		requestedTools.length > 0 &&
		requestedTools.every((name) =>
			["source_read", "source_list", "source_related"].includes(name),
		)
	);
}

function reducedLevel(name: string): "low" | "medium" | "high" {
	// Original Gemini 3 Pro supports low/high; 3.1 Pro adds medium.
	if (/^gemini-3-pro(?:-|$)/.test(name)) return "low";
	if (name.includes("image")) return "high";
	return "medium";
}
