import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.output/**",
      "**/dist-new/**",
      "**/.turbo/**",
      "**/.vercel/**",
      "**/.nx/**",
      "**/.alchemy/**",
      "**/coverage/**",
      "**/.nyc_output/**",
      "**/.cache/**",
      "**/tmp/**",
      "**/temp/**",
      "**/src/routeTree.gen.ts",
      "**/packages/db/.drizzle/**",
      "**/packages/db/src/migrations/**",
    ],
  },
  {
    // Expo requires CommonJS for its Metro and Babel config, which the
    // TypeScript-oriented defaults above reject on sight.
    files: ["apps/native/*.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
