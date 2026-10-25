// Lets the generator import workspace sources written with extensionless relative imports.
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`));
