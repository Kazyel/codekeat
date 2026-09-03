import { randomUUID } from "node:crypto";

import type { ModelCatalogRepository } from "../../models/index.js";
import type { ResolvedRepositoryPolicy } from "#features/repository-policy";
import type { ReviewReportRepository } from "../repositories/review-report.repository.js";
import type { ReviewRunRepository } from "../repositories/review-run.repository.js";
import type { ExistingReviewRun } from "../types/review-repository.types.js";
import type {
	RequestReview,
	ReviewRequestResult,
	ReviewWorkQueue,
} from "../types/review-run.types.js";

interface RequestReviewDependencies {
	readonly runRepository: ReviewRunRepository;
	readonly modelRepository: Pick<ModelCatalogRepository, "findSelectedModel">;
	readonly reportRepository: ReviewReportRepository;
	readonly queue: ReviewWorkQueue;
}

export async function requestReview(
	request: RequestReview,
	policy: ResolvedRepositoryPolicy,
	dependencies: RequestReviewDependencies,
): Promise<ReviewRequestResult> {
	const existingRun = dependencies.runRepository.findReviewRun(
		request.repositoryId,
		request.pullRequestNumber,
		request.headSha,
	);

	if (existingRun !== null) {
		return requestExistingReview(request, policy, existingRun, dependencies);
	}

	const model = dependencies.modelRepository.findSelectedModel();
	if (model === null) {
		throw new Error("No enabled review model is selected.");
	}
	const runState = getInitialReviewRunState(policy);
	const reviewRunId = randomUUID();

	const creation = dependencies.runRepository.createReviewRun({
		id: reviewRunId,
		githubRepositoryId: request.repositoryId,
		pullRequestNumber: request.pullRequestNumber,
		headSha: request.headSha,
		trigger: request.trigger,
		status: runState.status,
		policyJson: JSON.stringify(policy.policy),
		policySource: policy.source,
		policyWarningCode: policy.warningCode,
		ignoreReason: runState.ignoreReason,
		model,
	});

	if (creation === "duplicate") {
		return { kind: "duplicate", policy };
	}

	if (!policy.policy.enabled) {
		return { kind: "ignored", policy };
	}

	await dependencies.queue.enqueueReview(reviewRunId);
	return { kind: "queued", policy };
}

async function requestExistingReview(
	request: RequestReview,
	policy: ResolvedRepositoryPolicy,
	existingRun: ExistingReviewRun,
	dependencies: RequestReviewDependencies,
): Promise<ReviewRequestResult> {
	if (!policy.policy.enabled) {
		return { kind: "ignored", policy };
	}

	if (existingRun.status === "completed") {
		return requestCompletedReview(existingRun, policy, dependencies);
	}

	if (request.trigger !== "reopened") {
		return { kind: "duplicate", policy };
	}

	if (!isRequeueableReviewRun(existingRun)) {
		return { kind: "duplicate", policy };
	}

	return requeueExistingReview(request, existingRun, policy, dependencies);
}

function getInitialReviewRunState(policy: ResolvedRepositoryPolicy): {
	readonly status: "ignored" | "queued";
	readonly ignoreReason: "repository_policy_disabled" | null;
} {
	if (policy.policy.enabled) {
		return { status: "queued", ignoreReason: null };
	}

	return { status: "ignored", ignoreReason: "repository_policy_disabled" };
}

async function requestCompletedReview(
	existingRun: ExistingReviewRun,
	policy: ResolvedRepositoryPolicy,
	dependencies: RequestReviewDependencies,
): Promise<ReviewRequestResult> {
	const reportId = dependencies.reportRepository.prepareReviewReport(
		existingRun.id,
		randomUUID(),
	);
	if (reportId === null) {
		return { kind: "duplicate", policy };
	}

	await dependencies.queue.enqueueReport(reportId);
	return { kind: "report_queued", policy };
}

function isRequeueableReviewRun(existingRun: ExistingReviewRun): boolean {
	return existingRun.status === "failed" || existingRun.status === "ignored";
}

async function requeueExistingReview(
	request: RequestReview,
	existingRun: ExistingReviewRun,
	policy: ResolvedRepositoryPolicy,
	dependencies: RequestReviewDependencies,
): Promise<ReviewRequestResult> {
	const requeued = dependencies.runRepository.requeueReviewRun(existingRun.id, request.trigger);
	if (!requeued) {
		return { kind: "duplicate", policy };
	}

	await dependencies.queue.enqueueReview(existingRun.id);
	return { kind: "queued", policy };
}
