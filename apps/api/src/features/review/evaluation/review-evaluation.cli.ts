import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect, Semaphore } from "effect";
import { z } from "zod";
import {
	reviewEvaluationLabelsSchema,
	reviewEvaluationManifestSchema,
	reviewEvaluationResultSchema,
} from "./review-evaluation.schemas.js";
import { scoreReviewEvaluation } from "./review-evaluation-score.js";

const execute = promisify(execFile);
const repositoryDirectory = fileURLToPath(new URL("../../../../../../", import.meta.url));
const optionalQuota = z
	.string()
	.trim()
	.transform((value) => (value === "" ? undefined : value))
	.optional()
	.pipe(z.coerce.number<string | undefined>().int().positive().optional());
const commandSchema = z.discriminatedUnion("command", [
	z
		.object({
			command: z.literal("run"),
			manifest: z.string().min(1),
			output: z.string().min(1),
		})
		.strict(),
	z
		.object({
			command: z.literal("score"),
			results: z.string().min(1),
			labels: z.string().min(1),
			output: z.string().min(1),
		})
		.strict(),
]);

export async function runReviewEvaluationCli(arguments_: readonly string[]): Promise<void> {
	const command = parseCommand(arguments_);
	if (command.command === "score") {
		const results = reviewEvaluationResultSchema.parse(await readJson(command.results));
		const labels = reviewEvaluationLabelsSchema.parse(await readJson(command.labels));
		await saveJson(command.output, scoreReviewEvaluation(results, labels));
		return;
	}
	if (!import.meta.url.endsWith(".ts"))
		throw new Error(
			"Live evaluations must run the source CLI with tsx so the recorded revision identifies the loaded code.",
		);
	const manifest = reviewEvaluationManifestSchema.parse(await readJson(command.manifest));
	const { stdout: dirty } = await execute("git", ["status", "--porcelain"], {
		cwd: repositoryDirectory,
	});
	if (dirty.trim() !== "")
		throw new Error(
			"Live evaluations require a clean checkout to identify the actual runtime revision.",
		);
	const { stdout: revision } = await execute("git", ["rev-parse", "HEAD"], {
		cwd: repositoryDirectory,
	});
	const codeRevision = z
		.string()
		.regex(/^[a-f0-9]{40,64}$/)
		.parse(revision.trim());
	const liveDependencies = await createLiveDependencies(codeRevision);
	const semaphore = Effect.runSync(Semaphore.make(1));
	let initial = true;
	const recordResult = async (
		result: import("./review-evaluation.schemas.js").ReviewEvaluationResult,
	): Promise<void> =>
		Effect.runPromise(
			semaphore.withPermit(
				Effect.promise(async () => {
					const validated = reviewEvaluationResultSchema.parse(result);
					if (initial) {
						await saveJson(command.output, validated);
						initial = false;
						return;
					}
					const temporary = `${command.output}.tmp-${randomUUID()}`;
					try {
						await saveJson(temporary, validated);
						await rename(temporary, command.output);
					} finally {
						await rm(temporary, { force: true });
					}
				}),
			),
		);
	await saveJson(`${command.output}.manifest.json`, manifest);
	const dependencies = {
		...liveDependencies,
		artifactDirectory: `${command.output}.artifacts`,
		recordResult,
	};
	const { evaluateReviewCorpus } = await import("./review-evaluation.runner.js");
	const controller = new AbortController();
	const stop = (): void => controller.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		const result = await Effect.runPromise(evaluateReviewCorpus(manifest, dependencies), {
			signal: controller.signal,
		});
		await recordResult(result);
	} finally {
		process.removeListener("SIGINT", stop);
		process.removeListener("SIGTERM", stop);
	}
}

async function createLiveDependencies(
	codeRevision: string,
): Promise<import("./review-evaluation.runner.js").ReviewEvaluationDependencies> {
	const environment = z
		.object({
			GOOGLE_API_KEY: z.string().trim().min(1),
			REVIEW_MODEL_CONCURRENCY: z.coerce.number().int().positive().default(5),
			GOOGLE_REQUESTS_PER_MINUTE: optionalQuota,
			GOOGLE_INPUT_TOKENS_PER_MINUTE: optionalQuota,
		})
		.parse(process.env);
	const [
		{ createGoogle },
		{ default: pino },
		{ GeminiReviewService },
		{ createGoogleContextCapacityClient },
	] = await Promise.all([
		import("@ai-sdk/google"),
		import("pino"),
		import("../../../integrations/gemini/services/gemini-review.service.js"),
		import("../../../integrations/gemini/services/google-context-capacity.service.js"),
	]);
	const capacity = createGoogleContextCapacityClient(fetch, environment.GOOGLE_API_KEY, {
		concurrency: environment.REVIEW_MODEL_CONCURRENCY,
		requestsPerMinute: environment.GOOGLE_REQUESTS_PER_MINUTE ?? null,
		inputTokensPerMinute: environment.GOOGLE_INPUT_TOKENS_PER_MINUTE ?? null,
	});
	const service = new GeminiReviewService(
		createGoogle({ apiKey: environment.GOOGLE_API_KEY, fetch: capacity.fetch }),
		{
			listTools: async () => {
				throw new Error("Live MCP is disabled during frozen evaluations.");
			},
			callTool: async () => {
				throw new Error("Live MCP is disabled during frozen evaluations.");
			},
		},
		pino({ level: "warn" }),
	);
	return { reviewer: service, judge: service, codeRevision };
}

function parseCommand(arguments_: readonly string[]): z.infer<typeof commandSchema> {
	const [command, first, second, third] = arguments_;
	if (command === "run" && arguments_.length === 3)
		return commandSchema.parse({ command, manifest: first, output: second });
	if (command === "score" && arguments_.length === 4)
		return commandSchema.parse({ command, results: first, labels: second, output: third });
	throw new Error(
		"Usage: review-evaluation run <manifest.json> <output.json> | score <results.json> <labels.json> <output.json>",
	);
}
async function readJson(path: string): Promise<z.JSONType> {
	return z.json().parse(JSON.parse(await readFile(path, "utf8")));
}
async function saveJson(
	path: string,
	value: z.JSONType | import("./review-evaluation-score.js").ReviewEvaluationScore,
): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void runReviewEvaluationCli(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : "Evaluation failed."}\n`);
		process.exitCode = 1;
	});
}
