import { beforeAll, describe, expect, test } from "bun:test";
import { measureTe04FocusedReview, TE00_REVIEWER_SOURCE_BREADTH, type Te04FocusedReviewMeasurement } from "./te04-focused-review";

let measurement: Te04FocusedReviewMeasurement;

beforeAll(() => {
  measurement = measureTe04FocusedReview();
}, 60_000);

describe("TE-04 focused review measurement", () => {
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
    expect(measurement.non_diff_bundle_bytes).toBeLessThan(57_344);
    expect(measurement.reviewer_source_breadth).toBeLessThan(TE00_REVIEWER_SOURCE_BREADTH);
    expect(measurement.reviewer_source_paths).toEqual([...measurement.reviewer_source_paths].sort((a, b) => a.localeCompare(b)));
    expect(measurement.model_calls.availability).toBe("unavailable");
    expect(measurement.model_calls.value).toBeNull();
    expect(measurement.provider_latency.availability).toBe("unavailable");
    expect(measurement.reviewer_active_time.availability).toBe("available");
    expect(measurement.reviewer_active_time.value).toBeGreaterThanOrEqual(0);
  });
});

