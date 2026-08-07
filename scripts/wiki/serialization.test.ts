import { describe, expect, test } from "bun:test";
import { hashContent, jsonStable } from "./serialization";

describe("shared serialization", () => {
  test("sorts object keys recursively without reordering arrays", () => {
    expect(jsonStable({ z: { b: 2, a: 1 }, a: [{ z: 3, a: 4 }] })).toBe(
      '{\n  "a": [\n    {\n      "a": 4,\n      "z": 3\n    }\n  ],\n  "z": {\n    "a": 1,\n    "b": 2\n  }\n}\n',
    );
  });

  test("hashes text and bytes deterministically", () => {
    expect(hashContent("same")).toBe(hashContent(new TextEncoder().encode("same")));
    expect(hashContent("same")).not.toBe(hashContent("different"));
  });
});
