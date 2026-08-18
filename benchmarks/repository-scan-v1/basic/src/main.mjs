import { add, double } from "./math.mjs";

export function summarize(value) {
  return { doubled: double(value), incremented: add(value, 1) };
}
