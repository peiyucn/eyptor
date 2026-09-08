/**
 * 路径边界判断（纯函数，可单测）。
 * 用于「文档内路径链接打开文件」的越界防护：恶意 md 的链接（绝对路径 / `../` 逃逸）
 * 不得打开工作区之外的任意本地文件。
 */
import * as path from "path";

/** 判断 candidate（归一化后）是否位于 base 目录内（含 base 本身） */
export function isPathWithinBase(candidate: string, base: string): boolean {
    const rel = path.relative(path.resolve(base), path.resolve(candidate));
    if (rel === "") return true;
    if (path.isAbsolute(rel)) return false;
    return rel !== ".." && !rel.startsWith(".." + path.sep);
}
