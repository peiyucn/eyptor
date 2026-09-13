/**
 * 图床配置解析（纯函数，可单测；运行时不 import vscode）。
 *
 * 背景：1.2.0 将 `epytor.imageServerUrl` / `imageServerFieldName` /
 * `imageServerExtraParams` / `imageServerResponsePath` 四项合并为
 * `epytor.imageServer` 对象。旧 4 键保留但已弃用，解析时**新键优先、旧键兜底**，
 * 逐字段生效：新键提供了有效值就用新键，否则回退旧键，全无有效值才用默认值。
 * 解析只读配置，绝不改写用户 settings.json。
 *
 * 安全边界：multipart 表单的字段名与字段值都由这些配置拼接——key/value 一律剥掉
 * CRLF 与双引号（防请求头注入与 multipart 边界破坏）；fieldName 另走白名单
 * `/^[A-Za-z0-9_.\-]+$/`，非法值不得进入请求。
 */
import type * as vscode from "vscode";

export const DEFAULT_IMAGE_SERVER_FIELD_NAME = "file";
export const DEFAULT_IMAGE_SERVER_RESPONSE_PATH = "url";
/** fieldName 白名单（multipart Content-Disposition 的 name 参数） */
export const IMAGE_SERVER_FIELD_NAME_PATTERN = /^[A-Za-z0-9_.\-]+$/;

export interface ImageServerSettings {
    url: string;
    fieldName: string;
    extraParams: Record<string, string>;
    responsePath: string;
}

/** 弃用 4 键的原始值（未校验，逐字段兜底用） */
export interface LegacyImageServerSettings {
    url?: unknown;
    fieldName?: unknown;
    extraParams?: unknown;
    responsePath?: unknown;
}

export type ImageServerIssueKind =
    /** `epytor.imageServer` 整体不是对象 */
    | "settingsNotObject"
    /** `extraParams` 不是对象（数组/字符串/数字/null 等） */
    | "extraParamsNotObject"
    /** 弃用键 `imageServerExtraParams` 的 JSON 字符串解析失败 */
    | "extraParamsInvalidJson"
    /** `extraParams` 的某个值不是字符串/数字/布尔（含嵌套对象、数组） */
    | "extraParamsUnsupportedValue";

export interface ImageServerIssue {
    kind: ImageServerIssueKind;
    /** extraParamsUnsupportedValue：被忽略的键 */
    keys?: string[];
}

export interface ImageServerResolution {
    settings: ImageServerSettings;
    /** 非法配置（一律要求调用方给出用户可见反馈，不得静默忽略） */
    issues: ImageServerIssue[];
}

/** 本地化文案描述：message 为英文原文（l10n bundle 的键），args 为占位符实参 */
export interface LocalizableIssueMessage {
    message: string;
    args: string[];
}

/** issue → 用户可见文案（调用方交给 `vscode.l10n.t` 翻译后展示） */
export function describeImageServerIssue(issue: ImageServerIssue): LocalizableIssueMessage {
    switch (issue.kind) {
        case "settingsNotObject":
            return {
                message: "epytor.imageServer must be an object; the deprecated epytor.imageServer* settings are used instead",
                args: [],
            };
        case "extraParamsNotObject":
            return {
                message: "epytor.imageServer.extraParams must be a JSON object and was ignored",
                args: [],
            };
        case "extraParamsInvalidJson":
            return {
                message: "epytor.imageServerExtraParams is not valid JSON and was ignored",
                args: [],
            };
        case "extraParamsUnsupportedValue":
            return {
                message: "Only strings, numbers and booleans are supported in epytor.imageServer.extraParams (nested objects and arrays are not); ignored keys: {0}",
                args: [(issue.keys ?? []).join(", ")],
            };
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 剥掉 CRLF 与双引号并 trim（multipart 头注入 / 边界破坏防护）。
 * 返回空串表示该值不可用。
 */
export function sanitizeMultipartText(value: string): string {
    return value.replace(/[\r\n"]/g, "").trim();
}

/** 逐字段取值：候选按优先级排列，第一个通过规范化（返回非 undefined）的生效 */
function firstValid<T>(
    candidates: unknown[],
    normalize: (value: unknown) => T | undefined,
    fallback: T,
): T {
    for (const candidate of candidates) {
        const value = normalize(candidate);
        if (value !== undefined) { return value; }
    }
    return fallback;
}

function normalizeNonEmptyText(value: unknown): string | undefined {
    if (typeof value !== "string") { return undefined; }
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}

function normalizeFieldName(value: unknown): string | undefined {
    if (typeof value !== "string") { return undefined; }
    const trimmed = value.trim();
    return IMAGE_SERVER_FIELD_NAME_PATTERN.test(trimmed) ? trimmed : undefined;
}

/** 值 → multipart 字段值：仅字符串/数字/布尔可表达，其余（含嵌套对象、数组）返回 undefined */
function normalizeParamValue(value: unknown): string | undefined {
    if (typeof value === "string") { return sanitizeMultipartText(value); }
    if (typeof value === "number" && Number.isFinite(value)) { return String(value); }
    if (typeof value === "boolean") { return String(value); }
    return undefined;
}

function normalizeExtraParams(input: unknown): {
    params: Record<string, string>;
    issues: ImageServerIssue[];
} {
    if (!isPlainObject(input)) {
        return { params: {}, issues: [{ kind: "extraParamsNotObject" }] };
    }
    const params: Record<string, string> = {};
    const unsupported: string[] = [];
    for (const [rawKey, rawValue] of Object.entries(input)) {
        const key = sanitizeMultipartText(rawKey);
        const value = normalizeParamValue(rawValue);
        if (key === "" || value === undefined) {
            unsupported.push(rawKey);
            continue;
        }
        params[key] = value;
    }
    return {
        params,
        issues: unsupported.length > 0
            ? [{ kind: "extraParamsUnsupportedValue", keys: unsupported }]
            : [],
    };
}

/** 弃用键的 extraParams（JSON 对象字符串）→ 对象；非法时给出 issue */
function parseLegacyExtraParams(raw: unknown): {
    params: Record<string, string>;
    issues: ImageServerIssue[];
} {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") { return { params: {}, issues: [] }; }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { params: {}, issues: [{ kind: "extraParamsInvalidJson" }] };
    }
    return normalizeExtraParams(parsed);
}

/**
 * 解析图床配置：新键 `epytor.imageServer` 优先，弃用 4 键兜底。
 * 任何非法配置都通过 issues 返回（调用方必须给用户可见反馈）。
 */
export function resolveImageServerConfig(
    server: unknown,
    legacy: LegacyImageServerSettings = {},
): ImageServerResolution {
    const issues: ImageServerIssue[] = [];
    let obj: Record<string, unknown> | undefined;
    if (server === undefined || server === null) {
        obj = undefined;
    } else if (isPlainObject(server)) {
        obj = server;
    } else {
        issues.push({ kind: "settingsNotObject" });
        obj = undefined;
    }

    const url = firstValid([obj?.["url"], legacy.url], normalizeNonEmptyText, "");
    const fieldName = firstValid(
        [obj?.["fieldName"], legacy.fieldName],
        normalizeFieldName,
        DEFAULT_IMAGE_SERVER_FIELD_NAME,
    );
    const responsePath = firstValid(
        [obj?.["responsePath"], legacy.responsePath],
        normalizeNonEmptyText,
        DEFAULT_IMAGE_SERVER_RESPONSE_PATH,
    );

    let extra: { params: Record<string, string>; issues: ImageServerIssue[] };
    if (obj !== undefined && obj["extraParams"] !== undefined) {
        extra = normalizeExtraParams(obj["extraParams"]);
    } else {
        extra = parseLegacyExtraParams(legacy.extraParams);
    }
    issues.push(...extra.issues);

    return { settings: { url, fieldName, extraParams: extra.params, responsePath }, issues };
}

/** 图床目标（存储方式 / 上传地址）的来源 */
export interface ServerStorageOrigin {
    /** imageStorage 来自工作区级配置 */
    storageFromWorkspace: boolean;
    /** 生效的上传地址来自工作区级配置（新旧键都查） */
    urlFromWorkspace: boolean;
}

/**
 * 安全：判断图床目标是否由工作区级配置决定。
 *
 * 克隆仓库可随 `.vscode/settings.json` 注入 imageStorage=server 或
 * imageServer.url，把用户粘贴的图片上传到攻击者服务器；用户级全局配置是用户
 * 自己的选择，信任放行（与 imageLocalPath 同口径）。
 *
 * url 的判定口径：生效地址与任一处「工作区级」候选值文本相同（含新旧键）。
 * 宁可多降级一次，也不放过工作区级注入。
 */
export function readServerStorageOrigin(
    cfg: Pick<vscode.WorkspaceConfiguration, "inspect">,
    effectiveUrl: string,
): ServerStorageOrigin {
    const storageInspect = cfg.inspect?.("imageStorage");
    const storageFromWorkspace =
        storageInspect?.workspaceValue !== undefined ||
        storageInspect?.workspaceFolderValue !== undefined;

    const candidates: unknown[] = [];
    for (const section of ["imageServer", "imageServerUrl"]) {
        const inspect = cfg.inspect?.(section);
        if (!inspect) { continue; }
        for (const value of [inspect.workspaceFolderValue, inspect.workspaceValue]) {
            if (section === "imageServer") {
                if (isPlainObject(value)) { candidates.push(value["url"]); }
            } else {
                candidates.push(value);
            }
        }
    }
    const urlFromWorkspace = effectiveUrl !== "" && candidates.some(
        (candidate) => typeof candidate === "string" && candidate.trim() === effectiveUrl,
    );

    return { storageFromWorkspace, urlFromWorkspace };
}

/** 是否必须把已配置的 server 存储降级为本地（安全） */
export function shouldDowngradeServerStorage(origin: ServerStorageOrigin): boolean {
    return origin.storageFromWorkspace || origin.urlFromWorkspace;
}

/** 从 VS Code 配置读取（`cfg` 为 `getConfiguration("epytor", uri)`） */
export function readImageServerConfig(
    cfg: Pick<vscode.WorkspaceConfiguration, "get">,
): ImageServerResolution {
    return resolveImageServerConfig(cfg.get<unknown>("imageServer"), {
        url: cfg.get<string>("imageServerUrl", ""),
        fieldName: cfg.get<string>("imageServerFieldName", DEFAULT_IMAGE_SERVER_FIELD_NAME),
        extraParams: cfg.get<string>("imageServerExtraParams", ""),
        responsePath: cfg.get<string>("imageServerResponsePath", DEFAULT_IMAGE_SERVER_RESPONSE_PATH),
    });
}
