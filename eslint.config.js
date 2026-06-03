const typescriptEslintEslintPlugin = require("@typescript-eslint/eslint-plugin");
const typescriptEslintParser = require("@typescript-eslint/parser");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = [
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: typescriptEslintParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                project: "./tsconfig.json",
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

            // ── Type-aware rules ──────────────────────────────────────
            "@typescript-eslint/no-floating-promises": "error",   // Promises non gestite
            "@typescript-eslint/no-misused-promises": "error",    // Promises usate dove non previsto
            "@typescript-eslint/await-thenable": "error",         // await su non-Promise
            "no-return-await": "off",
            "@typescript-eslint/return-await": ["error", "in-try-catch"],  // return await solo in try/catch

            // ── L3 enforcement deterministico (backlog AI punto 4) ───────
            // fetch() senza secondo argomento = nessun signal/timeout possibile.
            // I/O di rete senza timeout = leak/hang silenzioso (L3.3). Bloccante,
            // non advisory: il codice attuale e' gia' conforme (tutte le fetch
            // hanno AbortController/AbortSignal.timeout). Previene regressioni.
            "no-restricted-syntax": ["error", {
                "selector": "CallExpression[callee.name='fetch'][arguments.length<2]",
                "message": "fetch() richiede un secondo argomento con signal (AbortController o AbortSignal.timeout). I/O di rete senza timeout viola L3.3 (timeout esplicito su ogni I/O).",
            }],
        },
    },
    eslintConfigPrettier,
    {
        ignores: ["dist/**", "node_modules/**", "coverage/**", "*.cjs"],
    },
];
