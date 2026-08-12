import { describe, expect, it } from "vitest";

import { parseGeminiReviewResponse } from "../src/modules/ai/gemini-review-model.js";
import { ReviewModelResponseError } from "../src/modules/ai/review-model.js";

describe("parseGeminiReviewResponse", () => {
  it("returns findings from a valid structured response", () => {
    const findings = parseGeminiReviewResponse(
      JSON.stringify({
        findings: [
          {
            severity: "high",
            path: "src/example.ts",
            line: 2,
            title: "A concrete problem",
            rationale: "The added line needs a concrete correction.",
          },
        ],
      }),
    );

    expect(findings).toHaveLength(1);
  });

  it("rejects invalid JSON and invalid schemas", () => {
    expect(() => parseGeminiReviewResponse("not-json")).toThrow(ReviewModelResponseError);
    expect(() =>
      parseGeminiReviewResponse(JSON.stringify({ findings: [{ title: "Missing fields" }] })),
    ).toThrow(ReviewModelResponseError);
  });
});
