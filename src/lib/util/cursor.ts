type CursorValue = string | number;

interface DecodedCursor {
  value: CursorValue;
  id: string;
}

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

export function encodeCursor(value: CursorValue | Date, id: string): string {
  const normalized = value instanceof Date ? value.toISOString() : value;
  return toBase64Url(JSON.stringify([normalized, id]));
}

export function decodeCursor(
  raw: string | null | undefined,
): DecodedCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(raw));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [value, id] = parsed;
    if (typeof id !== "string" || !id) return null;
    if (typeof value === "number") return { value, id };
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
      return { value, id };
    }
    return null;
  } catch {
    return null;
  }
}
