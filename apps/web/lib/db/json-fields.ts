// SQLite has no native array or JSON column types, so the schema stores
// list-shaped fields as JSON-encoded TEXT. These helpers wrap parse/stringify
// so call sites can keep treating the values as arrays/objects.

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseJsonArray<T = unknown>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function parseJsonObject<T = Record<string, unknown>>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
