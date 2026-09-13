/**
 * 图片本地目录解析（纯函数，可单测）。
 *
 * 写路径（imageService.saveImageLocally）与图库列举路径
 * （MarkdownEditorProvider._handleGetProjectImages）共用同一份解析，避免两处漂移：
 * 回归——列举路径此前**没有**越界检查，工作区级 imageLocalPath（恶意仓库可随
 * .vscode/settings.json 注入）能让「项目图片」面板列出工作区外任意目录
 * （例如 ~/.ssh）的文件名与缩略图。
 *
 * 口径与写路径一致：工作区级配置越界 → 降级 <文档目录>/images；用户级全局配置
 * 是用户自己的选择，信任放行。
 */
import * as path from "path";
import { isPathWithinBase } from "./pathGuard";

/** 自动检测用的候选目录（按优先级） */
export const CANDIDATE_IMAGE_DIRS = ["images", "imgs", "assets/images", "assets"];

export interface ImageLocalDirInput {
    /** imageLocalPath 配置值（调用方已 trim） */
    customPath: string;
    /** 文档所在目录（file scheme）；非 file 文档传 null */
    docDir: string | null;
    /** 工作区根目录；无工作区传 null */
    workspaceRoot: string | null;
    /** imageLocalPath 是否来自工作区级配置（cfg.inspect 判定） */
    workspaceLevel: boolean;
}

export type ImageLocalDirPlan =
    /** 配置了有效自定义目录（含越界降级后的目录） */
    | { kind: "fixed"; dir: string; downgraded: boolean }
    /** 未配置自定义目录：按 candidates 顺序探测，全不存在时回落 fallbackDir */
    | { kind: "probe"; candidates: string[]; fallbackDir: string | null };

/** 展开候选目录：root 优先序 × CANDIDATE_IMAGE_DIRS 顺序，去重 */
export function expandCandidateDirs(roots: Array<string | null>): string[] {
    const result: string[] = [];
    for (const root of roots) {
        if (!root) { continue; }
        for (const candidate of CANDIDATE_IMAGE_DIRS) {
            const dir = path.join(root, candidate);
            if (!result.includes(dir)) { result.push(dir); }
        }
    }
    return result;
}

/**
 * 解析图片目录计划。
 * - 有 customPath：绝对路径直接用，相对路径按「工作区根 → 文档目录」拼接；
 *   工作区级配置越界（或相对路径无基准可拼）→ 降级 <文档目录>/images。
 * - 无 customPath：返回候选目录（工作区根 → 文档目录 × CANDIDATE_IMAGE_DIRS）
 *   与回落目录 <文档目录>/images；非 file 文档两者皆空。
 */
export function planImageLocalDir(input: ImageLocalDirInput): ImageLocalDirPlan {
    const { customPath, docDir, workspaceRoot, workspaceLevel } = input;

    if (customPath) {
        const base = workspaceRoot ?? docDir;
        const resolved = path.isAbsolute(customPath)
            ? customPath
            : base ? path.resolve(base, customPath) : null;
        const allowedBase = workspaceRoot ?? docDir;
        if (resolved && (!workspaceLevel || (allowedBase !== null && isPathWithinBase(resolved, allowedBase)))) {
            return { kind: "fixed", dir: resolved, downgraded: false };
        }
        return docDir
            ? { kind: "fixed", dir: path.join(docDir, "images"), downgraded: true }
            : { kind: "probe", candidates: [], fallbackDir: null };
    }

    return {
        kind: "probe",
        candidates: expandCandidateDirs([workspaceRoot, docDir]),
        fallbackDir: docDir ? path.join(docDir, "images") : null,
    };
}
