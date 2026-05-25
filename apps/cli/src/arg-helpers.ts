/**
 * Citty parses CLI args at runtime to the declared types, but its TypeScript
 * surface types every value as `string | boolean | string[] | undefined`.
 * These helpers narrow at the boundary so command bodies can use real types.
 */

export function s(v: unknown, def = ""): string {
  return typeof v === "string" ? v : def;
}

export function sOpt(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function b(v: unknown, def = false): boolean {
  return typeof v === "boolean" ? v : def;
}

export function ss(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}
