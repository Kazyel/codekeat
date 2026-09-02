import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"#core/workflows": fileURLToPath(new URL("./src/core/workflows", import.meta.url)),
			"#features/auth": fileURLToPath(
				new URL("./src/features/auth/index.ts", import.meta.url),
			),
			"#features/github": fileURLToPath(
				new URL("./src/features/github/index.ts", import.meta.url),
			),
			"#features/repository-policy": fileURLToPath(
				new URL("./src/features/repository-policy/index.ts", import.meta.url),
			),
			"#features/review": fileURLToPath(
				new URL("./src/features/review/index.ts", import.meta.url),
			),
			"#integrations/gemini": fileURLToPath(
				new URL("./src/integrations/gemini/index.ts", import.meta.url),
			),
			"#integrations/takeat-mcp": fileURLToPath(
				new URL("./src/integrations/takeat-mcp/index.ts", import.meta.url),
			),
			"#shared/http": fileURLToPath(new URL("./src/shared/http/index.ts", import.meta.url)),
			"#shared/database": fileURLToPath(
				new URL("./src/shared/database/index.ts", import.meta.url),
			),
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
});
