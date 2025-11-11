// @ts-check
import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import vuePlugin from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import {fileURLToPath} from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// TypeScript project references
const projects = [
    "./tsconfig.json",
    "./client/tsconfig.json",
    "./server/tsconfig.json",
    "./shared/tsconfig.json",
    "./test/tsconfig.json",
];

// Base rules for all JavaScript/TypeScript files
const baseRules = {
    "block-scoped-var": "error",
    curly: ["error", "all"],
    "dot-notation": "error",
    eqeqeq: "error",
    "handle-callback-err": "error",
    "no-alert": "error",
    "no-catch-shadow": "error",
    "no-control-regex": "off",
    "no-console": "error",
    "no-duplicate-imports": "error",
    "no-else-return": "error",
    "no-implicit-globals": "error",
    "no-restricted-globals": ["error", "event", "fdescribe"],
    "no-template-curly-in-string": "error",
    "no-unsafe-negation": "error",
    "no-useless-computed-key": "error",
    "no-useless-constructor": "error",
    "no-useless-return": "error",
    "no-use-before-define": [
        "error",
        {
            functions: false,
        },
    ],
    "no-var": "error",
    "object-shorthand": [
        "error",
        "methods",
        {
            avoidExplicitReturnArrows: true,
        },
    ],
    "padding-line-between-statements": [
        "error",
        {
            blankLine: "always",
            prev: ["block", "block-like"],
            next: "*",
        },
        {
            blankLine: "always",
            prev: "*",
            next: ["block", "block-like"],
        },
    ],
    "prefer-const": "error",
    "prefer-rest-params": "error",
    "prefer-spread": "error",
    "spaced-comment": ["error", "always"],
    strict: "off",
    yoda: "error",
};

// Temporary relaxations for migration to ESLint 9
const generalRulesTemp = {
    "no-alert": "warn",
    "no-console": "warn",
    "no-use-before-define": [
        "warn",
        {
            functions: false,
        },
    ],
    "no-var": "warn",
    eqeqeq: "warn",
    "prefer-rest-params": "warn",
    "prefer-spread": "warn",
    yoda: "warn",
};

// TypeScript-specific rules
const tsRules = {
    // note you must disable the base rule as it can report incorrect errors
    "no-shadow": "off",
    "@typescript-eslint/no-shadow": ["error"],
    "@typescript-eslint/no-redundant-type-constituents": "off",
};

// Temporary TypeScript rules to be re-enabled later
const tsRulesTemp = {
    // TODO: eventually remove these
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-this-alias": "off",
    "@typescript-eslint/no-unnecessary-type-assertion": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-unused-expressions": "off",
    "@typescript-eslint/no-floating-promises": "off",
    "@typescript-eslint/only-throw-error": "off",
    "@typescript-eslint/no-unsafe-enum-comparison": "off",
    "@typescript-eslint/restrict-template-expressions": "off",
    "@typescript-eslint/prefer-promise-reject-errors": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/await-thenable": "off",
    "@typescript-eslint/no-require-imports": "off",
    "@typescript-eslint/no-empty-object-type": "off",
};

// Temporary test-specific TypeScript rules
const tsTestRulesTemp = {
    // TODO: remove these
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/restrict-plus-operands": "off",
};

// Vue-specific rules
const vueRules = {
    "import/no-default-export": 0,
    "import/unambiguous": 0, // vue SFC can miss script tags
    "@typescript-eslint/prefer-readonly": 0, // can be used in template
    "vue/component-tags-order": [
        "error",
        {
            order: ["template", "style", "script"],
        },
    ],
    "vue/multi-word-component-names": "off",
    "vue/no-mutating-props": "off",
    "vue/no-v-html": "off",
    "vue/require-default-prop": "off",
    "vue/v-slot-style": ["error", "longform"],
    "no-unused-vars": "warn",
};

export default [
    // 1. Ignore patterns (replaces .eslintignore)
    {
        ignores: ["public/**", "coverage/**", "dist/**", "xyz/**", "defaults/config.d.ts"],
    },

    // 2. ESLint recommended config for all files
    eslint.configs.recommended,

    // 3. Base config for all JavaScript files
    {
        files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.es6,
                ...globals.browser,
                ...globals.mocha,
                ...globals.node,
            },
        },
        rules: {
            ...baseRules,
            ...generalRulesTemp,
        },
    },

    // 4. TypeScript config - use TypeScript ESLint flat configs
    ...tseslint.configs["flat/recommended"].map((config) => ({
        ...config,
        files: ["**/*.ts"],
    })),
    ...tseslint.configs["flat/recommended-type-checked"].map((config) => ({
        ...config,
        files: ["**/*.ts"],
    })),
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                tsconfigRootDir: __dirname,
                project: projects,
            },
        },
        rules: {
            ...baseRules,
            ...generalRulesTemp,
            ...tsRules,
            ...tsRulesTemp,
        },
    },

    // 5. Vue config
    ...vuePlugin.configs["flat/recommended"],
    {
        files: ["**/*.vue"],
        languageOptions: {
            parser: vueParser,
            ecmaVersion: 2022,
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
                parser: tsparser,
                tsconfigRootDir: __dirname,
                extraFileExtensions: [".vue"],
            },
            globals: {
                ...globals.es6,
                ...globals.browser,
                ...globals.mocha,
                ...globals.node,
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            ...baseRules,
            ...generalRulesTemp,
            ...tsRules,
            ...tsRulesTemp,
            ...vueRules,
        },
    },

    // 6. Test files config
    {
        files: ["./test/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                tsconfigRootDir: __dirname,
                project: projects,
            },
        },
        rules: {
            ...baseRules,
            ...generalRulesTemp,
            ...tsRules,
            ...tsRulesTemp,
            ...tsTestRulesTemp,
            "@typescript-eslint/no-unused-expressions": "off", // Chai assertions
        },
    },

    // 7. Prettier config (must be last to override conflicting rules)
    prettierConfig,
];
