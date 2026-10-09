import type { ColorName } from "../ai/schema";

export const PALETTE: Record<ColorName, { bg: string; stroke: string }> = {
  yellow: { bg: "#fff3bf", stroke: "#e19b00" },
  blue: { bg: "#d0ebff", stroke: "#1c7ed6" },
  green: { bg: "#d3f9d8", stroke: "#2f9e44" },
  pink: { bg: "#ffdeeb", stroke: "#d6336c" },
  purple: { bg: "#e5dbff", stroke: "#7048e8" },
  orange: { bg: "#ffe8cc", stroke: "#e8590c" },
  gray: { bg: "#f1f3f5", stroke: "#495057" },
  red: { bg: "#ffe3e3", stroke: "#e03131" },
};

export const BRANCH_CYCLE: ColorName[] = ["blue", "green", "orange", "pink", "purple", "yellow"];
