import { defineConfig } from "vitest/config";
import path from "path";

/**
 * 基准探针专用配置：*.bench.ts 不参与 verify/CI，仅手动运行——
 * npx vitest run --config vitest.bench.config.ts
 */
export default defineConfig({
    resolve: {
        alias: {
            vscode: path.resolve(__dirname, "__mocks__/vscode.ts"),
            "@": path.resolve(__dirname, "webview"),
        },
    },
    test: {
        environment: "jsdom",
        include: ["webview/__tests__/**/*.bench.ts"],
        setupFiles: ["./webview/__tests__/setup.ts"],
    },
});
