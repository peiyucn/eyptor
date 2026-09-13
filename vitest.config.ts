import { defineConfig } from "vitest/config";
import path from "path";

const alias = {
    // 将 vscode 模块重定向到 mock 实现，Extension 侧单元测试所需
    vscode: path.resolve(__dirname, "__mocks__/vscode.ts"),
    "@": path.resolve(__dirname, "webview"),
};

export default defineConfig({
    resolve: { alias },
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: "extension",
                    environment: "node",
                    include: ["src/__tests__/**/*.test.ts", "shared/__tests__/**/*.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "webview",
                    environment: "jsdom",
                    include: ["webview/__tests__/**/*.test.ts"],
                    setupFiles: ["./webview/__tests__/setup.ts"],
                },
            },
        ],
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov", "html"],
            include: [
                "src/utils/**/*.ts",
                "src/MarkdownDocument.ts",
                "webview/i18n/**/*.ts",
                "webview/utils/**/*.ts",
            ],
            thresholds: {
                lines: 70,
                functions: 70,
                // AGENTS 分模块覆盖率底线（CI test:coverage 强制；实测各模块线覆盖远超底线）
                "src/utils/imageService.ts": { lines: 85 },
                "src/utils/getNonce.ts": { lines: 100 },
                "src/MarkdownDocument.ts": { lines: 80 },
                "src/utils/contentTransform.ts": { lines: 90 },
                "src/utils/lineMap.ts": { lines: 90 },
            },
        },
    },
});
