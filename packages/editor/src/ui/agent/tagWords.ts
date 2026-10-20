export function parseAiTagWords(text: string): string[] | null {
  if (!text.trim()) return [];
  const tags = text.split(",").map(word => word.trim());
  return tags.length <= 16 && tags.every(word => word.length > 0 && word.length <= 48) && new Set(tags).size === tags.length ? tags : null;
}
