import { beforeAll, describe, expect, test } from "bun:test";
import { measureTe04FocusedReview, TE00_REVIEWER_SOURCE_BREADTH, TE04_ENGINE_PATHS, TE04_ORIGIN_MAIN_STRUCTURAL_NON_DIFF_BYTES, type Te04FocusedReviewMeasurement } from "./te04-focused-review";

let measurement: Te04FocusedReviewMeasurement;

beforeAll(() => {
  measurement = measureTe04FocusedReview();
}, 60_000);

describe("TE-04 focused review measurement", () => {
  test("copies the complete KM-03 engine dependency closure", () => {
    expect(TE04_ENGINE_PATHS).toEqual(expect.arrayContaining([
      "scripts/wiki/core.ts",
      "scripts/wiki/verification.ts",
      "scripts/wiki/impact.ts",
      "scripts/wiki/review-bundle.ts",
      "scripts/wiki/review-attestation.ts",
      "scripts/wiki/kit-packaging.ts",
      "scripts/wiki/discovery.ts",
      "scripts/wiki/context.ts",
      "scripts/wiki/generated-views.ts",
      "scripts/wiki/model.ts",
      "scripts/wiki/serialization.ts",
      "scripts/wiki/repository-view.ts",
      "scripts/wiki/page-validation.ts",
      "scripts/wiki/work-validation.ts",
      "scripts/wiki/cli.ts",
      "scripts/wiki/cli-runtime.ts",
      "scripts/wiki/cli-render.ts",
      "scripts/wiki/cli-discovery-handlers.ts",
      "scripts/wiki/cli-generation-handlers.ts",
      "scripts/wiki/local-check.ts",
      "scripts/wiki/github-local-status.ts",
      "scripts/wiki/cli-validation-handlers.ts",
      "scripts/wiki/cli-review-handlers.ts",
    ]));
  });

  test("retains exact PASS and portable fixture correctness", () => {
    expect(measurement.version).toBe(1);
    expect(measurement.base_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(measurement.candidate_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(measurement.implementation_revision).toBe(measurement.base_sha);
    expect(measurement.bundle_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(measurement.exact_pass).toBe(true);
    expect(measurement.portable_fixture_correct).toBe(true);
  });

  test("removes reproduced structural breadth without making provider claims", () => {
    expect(measurement.authority_object_bytes).toBe(measurement.component_bytes.objects ?? 0);
    expect(measurement.authority_object_bytes).toBeGreaterThan(0);
    expect(measurement.structural_non_diff_bytes).toBe(
      measurement.non_diff_bundle_bytes - measurement.authority_object_bytes,
    );
    expect(measurement.structural_non_diff_bytes).toBeLessThanOrEqual(TE04_ORIGIN_MAIN_STRUCTURAL_NON_DIFF_BYTES);
    expect(measurement.reviewer_source_breadth).toBeLessThan(TE00_REVIEWER_SOURCE_BREADTH);
    expect(measurement.reviewer_source_paths).toEqual([...measurement.reviewer_source_paths].sort((a, b) => a.localeCompare(b)));
    expect(measurement.model_calls.availability).toBe("unavailable");
    expect(measurement.model_calls.value).toBeNull();
    expect(measurement.provider_latency.availability).toBe("unavailable");
    expect(measurement.reviewer_active_time.availability).toBe("available");
    expect(measurement.reviewer_active_time.value).toBeGreaterThanOrEqual(0);
  });
});
