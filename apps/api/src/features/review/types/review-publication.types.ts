import type { PublishableReviewReport, ReviewReportComment } from "./review-repository.types.js";

export interface ReviewReportPublisherClient {
	publish(report: PublishableReviewReport): Promise<ReviewReportComment>;
}
