import { describe, expect, it } from "vitest";

import {
  defaultRepositoryPolicy,
  resolveRepositoryPolicy,
} from "../src/modules/repository-policy/repository-policy.js";

describe("repository policy", () => {
  it("uses the default policy when no file exists", () => {
    expect(defaultRepositoryPolicy()).toEqual({
      policy: { version: 1, enabled: true },
      source: "default",
      warningCode: null,
    });
  });

  it("accepts the version 1 enabled flag", () => {
    expect(resolveRepositoryPolicy("version: 1\nenabled: false\n")).toEqual({
      policy: { version: 1, enabled: false },
      source: "repository",
      warningCode: null,
    });
  });

  it("falls back when the file has unsupported fields", () => {
    expect(resolveRepositoryPolicy("version: 1\nmodel: gemini\n")).toEqual({
      policy: { version: 1, enabled: true },
      source: "default",
      warningCode: "invalid_repository_policy",
    });
  });
});
