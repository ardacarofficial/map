/** Format 6 only adds authoring metadata. Never modifies cells, recipes, PNG references or the input tree. */
export function migrateV6(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.documentFormatVersion !== 'number' || input.documentFormatVersion >= 6) return input;
  return {
    ...input,
    documentFormatVersion: 6,
    ...(Array.isArray(input.collections) ? { collections: input.collections.map(value => {
      if (!value || typeof value !== 'object') return value;
      const c = value as Record<string, unknown>;
      if (!Array.isArray(c.cells)) return { ...c };
      let maxY = -1;
      for (const cell of c.cells) if (cell && typeof cell === 'object' && typeof cell.y === 'number') maxY = Math.max(maxY, cell.y);
      return { ...c, rows: Math.max(2, maxY + 2) };
    }) } : {}),
    ...(Array.isArray(input.generatedRecipes) ? { generatedRecipes: input.generatedRecipes.map(r => r && typeof r === 'object' ? migrateV6(r as Record<string, unknown>) : r) } : {}),
  };
}
