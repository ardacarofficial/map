// @ts-check
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Modules `@smap/core` must never import (see CLAUDE.md → Mimari). */
const CORE_FORBIDDEN_IMPORTS = [
  { group: ["react", "react/**", "react-dom", "react-dom/**"], message: "core React'i tanımaz." },
  { group: ["pixi.js", "pixi.js/**", "@pixi/**"], message: "core PixiJS'i tanımaz." },
  { group: ["@tauri-apps/**"], message: "core Tauri'yi tanımaz." },
  { group: ["zustand", "zustand/**"], message: "core Zustand'ı tanımaz." },
  { group: ["@smap/editor", "@smap/editor/**", "@smap/desktop", "@smap/desktop/**"], message: "Bağımlılık yönü: desktop → editor → core." },
  { group: ["node:*", "fs", "fs/**", "path", "buffer"], message: "core dosya sistemine / Node API'lerine dokunmaz." },
];

/** DOM / host globals forbidden in core (typecheck also fails: lib = ES2022 only). */
const CORE_FORBIDDEN_GLOBALS = [
  "window", "document", "navigator", "location", "localStorage", "sessionStorage",
  "requestAnimationFrame", "HTMLElement", "Element", "Image", "fetch", "self",
  "Buffer", "process", "btoa", "atob", "require", "__dirname",
].map((name) => ({ name, message: "core DOM/Node globallerini kullanamaz." }));

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "packages/desktop/src-tauri/**", "e2e/test-results/**", "e2e/playwright-report/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["*.{js,ts}", "packages/*/*.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["packages/core/**/*.ts"],
    languageOptions: { globals: {} },
    rules: {
      "no-restricted-imports": ["error", { patterns: CORE_FORBIDDEN_IMPORTS }],
      "no-restricted-globals": ["error", ...CORE_FORBIDDEN_GLOBALS],
    },
  },
  {
    files: ["packages/core/vitest.config.ts"],
    rules: { "no-restricted-imports": "off", "no-restricted-globals": "off" },
  },
  {
    files: ["packages/editor/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
