import assert from "node:assert/strict";
import test from "node:test";
import { ChartJS } from "../src/lib/util/chart";

test("画面で使うチャートの部品が登録されている", () => {
  for (const type of ["bar", "line"]) {
    assert.doesNotThrow(() => ChartJS.registry.getController(type), type);
  }
  for (const scale of ["category", "linear"]) {
    assert.doesNotThrow(() => ChartJS.registry.getScale(scale), scale);
  }
  for (const element of ["bar", "line", "point"]) {
    assert.doesNotThrow(() => ChartJS.registry.getElement(element), element);
  }
});
