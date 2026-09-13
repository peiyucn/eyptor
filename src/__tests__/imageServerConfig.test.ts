import { describe, it, expect, vi } from "vitest";
import {
    DEFAULT_IMAGE_SERVER_FIELD_NAME,
    DEFAULT_IMAGE_SERVER_RESPONSE_PATH,
    IMAGE_SERVER_FIELD_NAME_PATTERN,
    describeImageServerIssue,
    readImageServerConfig,
    readServerStorageOrigin,
    shouldDowngradeServerStorage,
    resolveImageServerConfig,
    sanitizeMultipartText,
} from "../../src/utils/imageServerConfig";

describe("resolveImageServerConfig — 新旧键优先级", () => {
    it("新键提供有效值时 应该 覆盖旧键（逐字段）", () => {
        const { settings, issues } = resolveImageServerConfig(
            { url: "https://new.example.com/api", fieldName: "img", extraParams: { a: "1" }, responsePath: "data.url" },
            { url: "https://old.example.com/api", fieldName: "file", extraParams: '{"b":"2"}', responsePath: "url" },
        );

        expect(settings).toEqual({
            url: "https://new.example.com/api",
            fieldName: "img",
            extraParams: { a: "1" },
            responsePath: "data.url",
        });
        expect(issues).toEqual([]);
    });

    it("新键缺字段时 应该 逐字段回退旧键", () => {
        const { settings, issues } = resolveImageServerConfig(
            { url: "https://new.example.com/api" },
            { url: "https://old.example.com/api", fieldName: "img", extraParams: '{"b":"2"}', responsePath: "data.url" },
        );

        expect(settings).toEqual({
            url: "https://new.example.com/api",
            fieldName: "img",
            extraParams: { b: "2" },
            responsePath: "data.url",
        });
        expect(issues).toEqual([]);
    });

    it("新旧键都没有时 应该 使用默认值", () => {
        const { settings, issues } = resolveImageServerConfig(undefined, {});

        expect(settings).toEqual({
            url: "",
            fieldName: DEFAULT_IMAGE_SERVER_FIELD_NAME,
            extraParams: {},
            responsePath: DEFAULT_IMAGE_SERVER_RESPONSE_PATH,
        });
        expect(issues).toEqual([]);
    });

    it("新键 extraParams 为空对象时 应该 视为有效值（不再回退旧键）", () => {
        const { settings } = resolveImageServerConfig(
            { extraParams: {} },
            { extraParams: '{"token":"legacy"}' },
        );

        expect(settings.extraParams).toEqual({});
    });

    it("imageServer 不是对象时 应该 报 issue 并完全回退旧键", () => {
        const { settings, issues } = resolveImageServerConfig("https://oops.example.com", {
            url: "https://old.example.com/api",
        });

        expect(settings.url).toBe("https://old.example.com/api");
        expect(issues.map((i) => i.kind)).toEqual(["settingsNotObject"]);
    });

    it("imageServer 为 null 时 应该 不报 issue（等同未配置）", () => {
        const { issues } = resolveImageServerConfig(null, {});

        expect(issues).toEqual([]);
    });
});

describe("resolveImageServerConfig — 非法值回退", () => {
    it("fieldName 含非法字符且旧键合法时 应该 回退旧键", () => {
        const { settings } = resolveImageServerConfig(
            { fieldName: "my file\"" },
            { fieldName: "upload" },
        );

        expect(settings.fieldName).toBe("upload");
    });

    it("fieldName 新旧键都非法时 应该 回退默认 file", () => {
        const { settings } = resolveImageServerConfig({ fieldName: "有中文" }, { fieldName: "" });

        expect(settings.fieldName).toBe(DEFAULT_IMAGE_SERVER_FIELD_NAME);
    });

    it("fieldName 白名单 应该 接受字母数字与 _ . -", () => {
        expect(IMAGE_SERVER_FIELD_NAME_PATTERN.test("upload_1.x-y")).toBe(true);
        expect(IMAGE_SERVER_FIELD_NAME_PATTERN.test("upload 1")).toBe(false);
        expect(IMAGE_SERVER_FIELD_NAME_PATTERN.test("上传")).toBe(false);
    });

    it("url 为空串时 应该 回退旧键；旧键也空则回退空串", () => {
        const fallback = resolveImageServerConfig({ url: "   " }, { url: "https://old.example.com" });
        expect(fallback.settings.url).toBe("https://old.example.com");

        const none = resolveImageServerConfig({ url: "   " }, { url: "" });
        expect(none.settings.url).toBe("");
    });

    it("url/responsePath 非字符串时 应该 回退下一个候选", () => {
        const { settings } = resolveImageServerConfig(
            { url: 123, responsePath: { a: 1 } },
            { url: "https://old.example.com", responsePath: "data.url" },
        );

        expect(settings.url).toBe("https://old.example.com");
        expect(settings.responsePath).toBe("data.url");
    });
});

describe("resolveImageServerConfig — extraParams 类型与嵌套", () => {
    it("extraParams 不是对象时 应该 报 issue 并回退空对象", () => {
        const { settings, issues } = resolveImageServerConfig(
            { extraParams: "token=abc" },
            {},
        );

        expect(settings.extraParams).toEqual({});
        expect(issues.map((i) => i.kind)).toEqual(["extraParamsNotObject"]);
    });

    it("extraParams 为数组时 应该 报 issue（数组不是对象）", () => {
        const { settings, issues } = resolveImageServerConfig({ extraParams: ["a"] }, {});

        expect(settings.extraParams).toEqual({});
        expect(issues.map((i) => i.kind)).toEqual(["extraParamsNotObject"]);
    });

    it("extraParams 值为嵌套对象或数组时 应该 报 issue 并列出被忽略的键", () => {
        const { settings, issues } = resolveImageServerConfig(
            { extraParams: { ok: "1", nested: { deep: { deeper: 1 } }, arr: [1, 2], nul: null } },
            {},
        );

        expect(settings.extraParams).toEqual({ ok: "1" });
        expect(issues).toEqual([
            { kind: "extraParamsUnsupportedValue", keys: ["nested", "arr", "nul"] },
        ]);
    });

    it("extraParams 值为数字/布尔时 应该 转成字符串", () => {
        const { settings, issues } = resolveImageServerConfig(
            { extraParams: { n: 1, f: 1.5, b: true, nan: Number.NaN } },
            {},
        );

        expect(settings.extraParams).toEqual({ n: "1", f: "1.5", b: "true" });
        expect(issues).toEqual([{ kind: "extraParamsUnsupportedValue", keys: ["nan"] }]);
    });

    it("旧键 extraParams 为合法 JSON 字符串时 应该 解析使用", () => {
        const { settings, issues } = resolveImageServerConfig(undefined, {
            extraParams: '{"token":"abc","n":2}',
        });

        expect(settings.extraParams).toEqual({ token: "abc", n: "2" });
        expect(issues).toEqual([]);
    });

    it("旧键 extraParams 为非法 JSON 时 应该 报 issue 而非静默忽略", () => {
        const { settings, issues } = resolveImageServerConfig(undefined, {
            extraParams: "not-valid-json!!!",
        });

        expect(settings.extraParams).toEqual({});
        expect(issues.map((i) => i.kind)).toEqual(["extraParamsInvalidJson"]);
    });

    it("旧键 extraParams 解析结果不是对象时 应该 报 issue", () => {
        const { issues } = resolveImageServerConfig(undefined, { extraParams: '"just-a-string"' });

        expect(issues.map((i) => i.kind)).toEqual(["extraParamsNotObject"]);
    });
});

describe("sanitizeMultipartText", () => {
    it("CRLF 与双引号 应该 被剥掉并 trim", () => {
        expect(sanitizeMultipartText('a\r\nb"c" ')).toBe("abc");
    });

    it("仅含 CRLF/引号时 应该 返回空串", () => {
        expect(sanitizeMultipartText('\r\n""')).toBe("");
    });
});

describe("resolveImageServerConfig — CRLF 与引号剥离", () => {
    it("extraParams 的 key/value 注入 CRLF 或引号时 应该 剥离（防 multipart 头注入）", () => {
        const { settings } = resolveImageServerConfig(
            { extraParams: { 'a\r\nX-Evil: 1': 'v\r\n--boundary"' } },
            {},
        );

        expect(settings.extraParams).toEqual({ "aX-Evil: 1": "v--boundary" });
    });
});

describe("readImageServerConfig", () => {
    it("应该 读取新键 epytor.imageServer 并回退旧 4 键", () => {
        const get = vi.fn((key: string, def?: unknown) => {
            if (key === "imageServer") return { url: "https://new.example.com" };
            if (key === "imageServerFieldName") return "legacyField";
            return def;
        });

        const { settings } = readImageServerConfig({ get } as never);

        expect(settings.url).toBe("https://new.example.com");
        expect(settings.fieldName).toBe("legacyField");
        expect(settings.responsePath).toBe(DEFAULT_IMAGE_SERVER_RESPONSE_PATH);
    });
});

describe("readServerStorageOrigin / shouldDowngradeServerStorage", () => {
    /** 只提供 inspect 的配置桩（inspect 返回值按 section 注入） */
    const makeCfg = (sections: Record<string, unknown>) => ({
        inspect: (key: string) => sections[key] as never,
    });

    it("imageStorage 来自工作区级 应该 判定为需降级", () => {
        const origin = readServerStorageOrigin(
            makeCfg({ imageStorage: { workspaceValue: "server" } }),
            "",
        );

        expect(origin).toEqual({ storageFromWorkspace: true, urlFromWorkspace: false });
        expect(shouldDowngradeServerStorage(origin)).toBe(true);
    });

    it("imageStorage 来自 workspaceFolder 也应该 判定为需降级", () => {
        const origin = readServerStorageOrigin(
            makeCfg({ imageStorage: { workspaceFolderValue: "server" } }),
            "",
        );

        expect(origin.storageFromWorkspace).toBe(true);
    });

    it("生效 url 与新键的工作区级 url 相同 应该 判定为需降级", () => {
        const origin = readServerStorageOrigin(
            makeCfg({ imageServer: { workspaceValue: { url: "https://evil.example.com/api" } } }),
            "https://evil.example.com/api",
        );

        expect(origin.urlFromWorkspace).toBe(true);
        expect(shouldDowngradeServerStorage(origin)).toBe(true);
    });

    it("生效 url 与旧键的工作区级 url 相同 应该 判定为需降级", () => {
        const origin = readServerStorageOrigin(
            makeCfg({ imageServerUrl: { workspaceFolderValue: "https://evil.example.com/api" } }),
            "https://evil.example.com/api",
        );

        expect(origin.urlFromWorkspace).toBe(true);
    });

    it("生效 url 只出现在用户级配置 应该 放行", () => {
        const origin = readServerStorageOrigin(
            makeCfg({ imageServer: { globalValue: { url: "https://mine.example.com/api" } } }),
            "https://mine.example.com/api",
        );

        expect(origin.urlFromWorkspace).toBe(false);
        expect(shouldDowngradeServerStorage(origin)).toBe(false);
    });

    it("无生效 url 且 imageStorage 非工作区级 应该 放行", () => {
        const origin = readServerStorageOrigin(
            makeCfg({ imageStorage: { globalValue: "server" } }),
            "",
        );

        expect(shouldDowngradeServerStorage(origin)).toBe(false);
    });

    it("inspect 不存在时 应该 不抛错且放行", () => {
        const origin = readServerStorageOrigin({ inspect: undefined } as never, "https://x.example.com");

        expect(shouldDowngradeServerStorage(origin)).toBe(false);
    });
});

describe("describeImageServerIssue", () => {
    it("每种 issue 应该 给出 l10n 英文原文键", () => {
        expect(describeImageServerIssue({ kind: "settingsNotObject" }).message)
            .toContain("epytor.imageServer must be an object");
        expect(describeImageServerIssue({ kind: "extraParamsNotObject" }).message)
            .toContain("must be a JSON object");
        expect(describeImageServerIssue({ kind: "extraParamsInvalidJson" }).message)
            .toContain("not valid JSON");
        expect(describeImageServerIssue({ kind: "extraParamsUnsupportedValue", keys: ["a", "b"] }))
            .toEqual({
                message: expect.stringContaining("ignored keys: {0}"),
                args: ["a, b"],
            });
    });
});
