import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { isPathWithinBase } from "./pathGuard";

// ─── 常量 ────────────────────────────────────────────────────
const MAX_ALT_TEXT_LENGTH = 20;
const UPLOAD_TIMEOUT_MS = 30_000;
/** 上传响应体大小上限（回归：chunks 无界累积可造成内存峰值） */
const MAX_UPLOAD_RESPONSE_BYTES = 1024 * 1024;

// 按点分路径从对象中提取值
export function getByPath(obj: unknown, dotPath: string): unknown {
    return dotPath.split(".").reduce<unknown>((acc, key) => {
        if (acc != null && typeof acc === "object") {
            return (acc as Record<string, unknown>)[key];
        }
        return undefined;
    }, obj);
}

// 从 MIME type 推导扩展名
export function mimeToExt(mimeType: string): string {
    const map: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/svg+xml": "svg",
        "image/bmp": "bmp",
        "image/tiff": "tiff",
    };
    return map[mimeType] ?? "png";
}

// 生成不冲突的文件名
export function generateFilename(altText: string, mimeType: string): string {
    const sanitized =
        (altText || "image")
            .slice(0, MAX_ALT_TEXT_LENGTH)
            .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "") || "image";
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    const ext = mimeToExt(mimeType);
    return `${sanitized}_${ts}_${rand}.${ext}`;
}

// 候选图片目录列表（按优先级）
const CANDIDATE_DIRS = ["images", "imgs", "assets/images", "assets"];

// 检测目录是否存在
async function dirExists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return stat.type === vscode.FileType.Directory;
    } catch {
        return false;
    }
}

export interface SaveImageResult {
    relPath: string;
    absUri: vscode.Uri;
}

/**
 * 将图片保存到本地磁盘，返回相对于 .md 文件的路径和绝对 Uri
 */
export async function saveImageLocally(
    docUri: vscode.Uri,
    cfg: vscode.WorkspaceConfiguration,
    data: Uint8Array,
    mimeType: string,
    altText: string,
): Promise<SaveImageResult> {
    const ext = mimeToExt(mimeType);
    let targetDir: vscode.Uri;

    const customPath = cfg.get<string>("imageLocalPath", "").trim();

    if (customPath) {
        // 自定义路径：绝对路径直接用，相对路径优先 workspace root 再退回 .md 目录。
        // 边界校验仅针对「工作区级」配置（恶意仓库可随 .vscode/settings.json 注入、
        // 把 imageLocalPath 指向任意目录如 ~/.ssh）；用户级全局配置是用户自己的选择，
        // 信任放行。越界时降级默认 images/。
        const inspect = cfg.inspect?.<string>("imageLocalPath");
        const workspaceLevel =
            inspect?.workspaceValue !== undefined ||
            inspect?.workspaceFolderValue !== undefined;
        const wsFolder = vscode.workspace.getWorkspaceFolder(docUri);
        const mdDir = path.dirname(docUri.fsPath);
        const resolved = path.isAbsolute(customPath)
            ? customPath
            : path.resolve(wsFolder?.uri.fsPath ?? mdDir, customPath);
        const allowedBase = wsFolder?.uri.fsPath ?? mdDir;
        targetDir =
            !workspaceLevel || isPathWithinBase(resolved, allowedBase)
                ? vscode.Uri.file(resolved)
                : vscode.Uri.file(path.join(mdDir, "images"));
        // 确保目录存在
        await vscode.workspace.fs.createDirectory(targetDir);
    } else if (docUri.scheme !== "file") {
        // untitled 文件降级保存到 home/images/
        targetDir = vscode.Uri.file(path.join(os.homedir(), "images"));
        await vscode.workspace.fs.createDirectory(targetDir);
    } else {
        // 自动检测：先在 workspace root 下找，再在 .md 同级目录找
        const mdDir = vscode.Uri.joinPath(docUri, "..");
        const wsFolder = vscode.workspace.getWorkspaceFolder(docUri);
        const searchRoots = wsFolder ? [wsFolder.uri, mdDir] : [mdDir];

        targetDir = vscode.Uri.joinPath(mdDir, "images"); // 默认兜底
        let found = false;

        outer: for (const root of searchRoots) {
            for (const candidate of CANDIDATE_DIRS) {
                const candidateUri = vscode.Uri.joinPath(root, candidate);
                if (await dirExists(candidateUri)) {
                    targetDir = candidateUri;
                    found = true;
                    break outer;
                }
            }
        }

        if (!found) {
            // 在 .md 文件同级目录创建 images/
            targetDir = vscode.Uri.joinPath(mdDir, "images");
            await vscode.workspace.fs.createDirectory(targetDir);
        }
    }

    // ── 去重：MD5 比对目录内同扩展名文件 ────────────────
    const newHash = crypto.createHash("md5").update(data).digest("hex");
    let entries: [string, vscode.FileType][] = [];
    try {
        entries = await vscode.workspace.fs.readDirectory(targetDir);
    } catch {
        /* ignore */
    }
    for (const [name, type] of entries) {
        if (type !== vscode.FileType.File) {
            continue;
        }
        if (!name.endsWith("." + ext)) {
            continue;
        }
        const existingUri = vscode.Uri.joinPath(targetDir, name);
        let existingData: Uint8Array | null = null;
        try {
            existingData = await vscode.workspace.fs.readFile(existingUri);
        } catch {
            /* ignore */
        }
        if (!existingData) {
            continue;
        }
        const existingHash = crypto
            .createHash("md5")
            .update(existingData)
            .digest("hex");
        if (existingHash === newHash) {
            // 复用已有文件
            const relPath = buildRelPath(docUri, existingUri);
            return { relPath, absUri: existingUri };
        }
    }

    const filename = generateFilename(altText, mimeType);
    const fileUri = vscode.Uri.joinPath(targetDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, data);

    const relPath = buildRelPath(docUri, fileUri);
    return { relPath, absUri: fileUri };
}

export function buildRelPath(docUri: vscode.Uri, fileUri: vscode.Uri): string {
    if (docUri.scheme !== "file") {
        return fileUri.fsPath; // untitled：返回绝对路径
    }
    const mdDir = path.dirname(docUri.fsPath);
    let rel = path.relative(mdDir, fileUri.fsPath).replace(/\\/g, "/");
    if (!rel.startsWith(".")) {
        rel = "./" + rel;
    }
    return rel;
}

/**
 * 上传图片到远程服务器，返回图片 URL
 */
export async function uploadImageToServer(
    cfg: vscode.WorkspaceConfiguration,
    data: Uint8Array,
    mimeType: string,
    altText: string,
): Promise<string> {
    const serverUrl = cfg.get<string>("imageServerUrl", "").trim();
    if (!serverUrl) {
        throw new Error("请先在设置中配置 epytor.imageServerUrl");
    }

    const fieldName =
        cfg.get<string>("imageServerFieldName", "file").trim() || "file";
    const responsePath =
        cfg.get<string>("imageServerResponsePath", "url").trim() || "url";

    // 解析额外参数
    let extraParams: Record<string, string> = {};
    const extraParamsStr = cfg.get<string>("imageServerExtraParams", "").trim();
    if (extraParamsStr) {
        try {
            extraParams = JSON.parse(extraParamsStr);
        } catch {
            // 非法 JSON 忽略，继续上传
        }
    }

    // 构建 multipart/form-data
    const boundary = `----FormBoundary${Date.now().toString(16)}`;
    const filename = generateFilename(altText, mimeType);
    const CRLF = "\r\n";

    const parts: Buffer[] = [];

    // 额外参数
    for (const [key, value] of Object.entries(extraParams)) {
        parts.push(
            Buffer.from(
                `--${boundary}${CRLF}` +
                    `Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}` +
                    `${value}${CRLF}`,
            ),
        );
    }

    // 图片文件
    parts.push(
        Buffer.from(
            `--${boundary}${CRLF}` +
                `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"${CRLF}` +
                `Content-Type: ${mimeType}${CRLF}${CRLF}`,
        ),
    );
    parts.push(Buffer.from(data));
    parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));

    const body = Buffer.concat(parts);

    const url = new URL(serverUrl);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const responseBody = await new Promise<string>((resolve, reject) => {
        const options: http.RequestOptions = {
            method: "POST",
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": body.length,
            },
        };

        const req = transport.request(options, (res) => {
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            res.on("data", (chunk: Buffer) => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_UPLOAD_RESPONSE_BYTES) {
                    // 响应体大小上限：直接结算（不依赖 error 事件），destroy 断开连接
                    req.destroy();
                    reject(new Error(`Upload response exceeds ${MAX_UPLOAD_RESPONSE_BYTES} bytes`));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () =>
                resolve(Buffer.concat(chunks).toString("utf-8")),
            );
        });

        req.on("error", reject);

        // 30 秒超时
        req.setTimeout(UPLOAD_TIMEOUT_MS, () => {
            req.destroy(new Error("Upload request timed out after 30s"));
        });

        req.write(body);
        req.end();
    });

    let parsed: unknown;
    try {
        parsed = JSON.parse(responseBody);
    } catch {
        // 不回显响应体（回归：服务器响应可能回显请求参数——imageServerExtraParams
        // 可能含 token，原样进错误提示与 WebView 面板）
        throw new Error("Server returned non-JSON response");
    }

    const imageUrl = getByPath(parsed, responsePath);
    if (typeof imageUrl !== "string" || !imageUrl) {
        throw new Error(
            `Cannot extract URL using path "${responsePath}" from response`,
        );
    }

    return imageUrl;
}
