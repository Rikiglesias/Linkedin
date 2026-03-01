const typescriptEslintEslintPlugin = require("@typescript-eslint/eslint-plugin");
const typescriptEslintParser = require("@typescript-eslint/parser");

module.exports = [
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: typescriptEslintParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                // project: "./tsconfig.json", // Decommentare per abilitare le regole type-aware
            },
        },
        plugins: {
            "@typescript-eslint": typescriptEslintEslintPlugin,
        },
        rules: {
            // ── Regole base ──────────────────────────────────────────────
            "no-console": "off",
            "semi": ["error", "always"],
            "eqeqeq": ["error", "always"],           // === sempre, no ==
            "prefer-const": "error",                  // const dove possibile
            "no-var": "error",                        // no var, solo let/const
            "curly": ["error", "multi-line"],           // {} obbligatori solo per multi-riga
            "no-return-await": "error",               // return await è ridondante (wrap + microtask inutile)

            // ── TypeScript ───────────────────────────────────────────────
            "@typescript-eslint/no-unused-vars": ["error", {
                "argsIgnorePattern": "^_",            // _req, _res ok
                "varsIgnorePattern": "^_",
            }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-non-null-assertion": "warn",  // Evita ! dove possibile
        },
    },
    {
        // Ignora i file generati e le directory di build
        ignores: ["dist/**", "node_modules/**", "coverage/**", "*.cjs"],
    },
];
