export function parseKeywordText(text?: string | null) {
  if (!text) return [];
  const values = text
    .split(/[\r\n,，、;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}
