import js from "@eslint/js";
import globals from "globals";

export default [
  // Local one-off scripts that are gitignored (never committed)
  { ignores: ["node_modules/", "*.json", "fakeusergenerate.js", "transactionGenerate.js", "scriptFetchFirebase.js"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_|^next$", caughtErrors: "none" }],
    },
  },
];
