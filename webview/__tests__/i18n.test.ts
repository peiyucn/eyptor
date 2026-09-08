import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadI18n(
    translations: Record<string, string> = {},
    isMac = false,
) {
    window.__i18n = { translations, isMac };
    vi.resetModules();
    return import("../../webview/i18n");
}

describe("WebView i18n", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete window.__i18n;
    });

    it("翻译存在时 应该 返回对应译文", async () => {
        const { t } = await loadI18n({ Save: "保存" });

        expect(t("Save")).toBe("保存");
    });

    it("翻译不存在时 应该 返回原始 key", async () => {
        const { t } = await loadI18n();

        expect(t("Missing translation")).toBe("Missing translation");
    });

    it("Mac 快捷键包含修饰键时 应该 转为无分隔符符号", async () => {
        const { kbd } = await loadI18n({}, true);

        expect(kbd("Mod-Shift-Alt-z")).toBe("⌘⇧⌥Z");
    });

    it("Windows 快捷键包含修饰键时 应该 转为加号分隔文本", async () => {
        const { kbd } = await loadI18n();

        expect(kbd("Mod-Shift-Alt-z")).toBe("Ctrl+Shift+Alt+Z");
    });

    it("未注入配置时 应该 使用英文与 Windows 默认值", async () => {
        vi.resetModules();
        const { kbd, t } = await import("../../webview/i18n");

        expect(t("Save")).toBe("Save");
        expect(kbd("Mod-b")).toBe("Ctrl+B");
    });

    it("词典键 应该 与代码 t() 字面键一一对应（无死键/无缺键，回归：曾 41% 死键 + 4 缺键）", () => {
        // 静态字符串级比对：读词典源码与 webview 全部生产 ts 文件（测试目录除外），
        // 提取 t('...')/t("...") 字面量，防「改代码不删词典键 / 用新键不补词典」再次漂移
        const repoRoot = path.resolve(process.cwd());
        const dictSrc = readFileSync(
            path.join(repoRoot, "src", "i18n", "webviewTranslations.ts"),
            "utf-8",
        );
        const dictKeys = Array.from(
            dictSrc.matchAll(/'((?:[^'\\]|\\.)*)':\s*'/g),
            (m) => m[1].replace(/\\'/g, "'"),
        );

        const webviewDir = path.join(repoRoot, "webview");
        const sources = collectTsSources(webviewDir);
        const usedKeys = new Set<string>();
        for (const src of sources) {
            for (const m of src.matchAll(/\bt\(\s*['"]([^'"]*)['"]/g)) {
                usedKeys.add(m[1]);
            }
        }

        const dead = dictKeys.filter((key) => !usedKeys.has(key));
        const missing = Array.from(usedKeys).filter((key) => !dictKeys.includes(key));
        expect(dead).toEqual([]);
        expect(missing).toEqual([]);
    });
});

/** 递归收集目录下所有 ts 文件（跳过 __tests__）的内容 */
function collectTsSources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__tests__") continue;
            out.push(...collectTsSources(full));
        } else if (entry.name.endsWith(".ts")) {
            out.push(readFileSync(full, "utf-8"));
        }
    }
    return out;
}