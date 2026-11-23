import { defineConfig } from "vitest/config";
import path from "node:path";

const postgresIntegration = process.env.RESEARCH_POSTGRES_TEST === "1";
// Unit tests always use temporary local data, even if a shell inherited live credentials.
if (!postgresIntegration) {
  delete process.env.RESEARCH_DATABASE_HOST;
  delete process.env.RESEARCH_DATABASE_URL;
} else if (
  !/^qa_pg_[a-z0-9_]+$/.test(process.env.RESEARCH_DATABASE_SCHEMA || "")
) {
  throw new Error("PostgreSQL 集成测试需要独立的 qa_pg_ 数据库命名空间");
}

export default defineConfig({
  test: {
    environment: "node",
    include: postgresIntegration
      ? [
          "tests/lib/research-knowledge-pg.integration.test.ts",
          "tests/lib/research-postgres-workspace.integration.test.ts",
          "tests/lib/research-discovery-pg.integration.test.ts",
        ]
      : ["tests/**/*.test.ts"],
    exclude: postgresIntegration ? [] : ["tests/**/*.integration.test.ts"],
    maxWorkers: 4,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
