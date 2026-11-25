import next from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import typescript from "typescript-eslint";

export default defineConfig(
  globalIgnores([".next/**", "next-env.d.ts", "src/components/breeze/**", "playwright-report/**", "test-results/**"]),
  typescript.configs.recommended,
  reactHooks.configs.flat.recommended,
  next.configs["core-web-vitals"],
);
