import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "db/migrations"));
      return {
        wrangler: { configPath: "./wrangler.toml" },
        remoteBindings: false,
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ENV_NAME: "test" }
        }
      };
    })
  ],
  test: {
    include: ["tests/worker/**/*.test.ts"],
    setupFiles: ["./tests/worker/setup.ts"],
    testTimeout: 30000
  }
});
