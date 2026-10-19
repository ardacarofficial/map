/** Format 5 adds thick smart sources and layout-2 atlases. Existing cells and slot ids are unchanged. */
export function migrateV5(input:Record<string,unknown>):Record<string,unknown> {
 if(typeof input.documentFormatVersion!=="number"||input.documentFormatVersion>=5)return input;
 return {...input,documentFormatVersion:5,...(Array.isArray(input.generatedRecipes)?{generatedRecipes:input.generatedRecipes.map(r=>r&&typeof r==="object"?migrateV5(r as Record<string,unknown>):r)}:{})};
}
