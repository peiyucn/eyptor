/**
 * 路径边界判断（纯函数，可单测）。
 * 用于「文档内路径链接打开文件」的越界防护：恶意 md 的链接（绝对路径 / `../` 逃逸）
 * 不得打开工作区之外的任意本地文件。
 */
import * as path from "path";

/**
 * 路径原语（默认当前平台的 `path`）。
 *
 * 存在的理由：CI 跑在 ubuntu-latest，而目标用户是 Windows——测试里写死 `C:\...` 时，
 * Linux 的 `path.resolve` 会把它当成**相对路径**，用例必然假红（回归 2026-09-13：
 * `pathGuard.test.ts` 因此让 `dev` 的 CI 红了 8 天）。注入 `path.win32` / `path.posix`
 * 后，两种平台语义都能在任意 OS 上被断言。
 */
export type PathPrimitives = Pick<typeof path, "resolve" | "relative" | "isAbsolute" | "sep">;

/** 判断 candidate（归一化后）是否位于 base 目录内（含 base 本身） */
export function isPathWithinBase(
    candidate: string,
    base: string,
    pathImpl: PathPrimitives = path,
): boolean {
    const rel = pathImpl.relative(pathImpl.resolve(base), pathImpl.resolve(candidate));
    if (rel === "") return true;
    if (pathImpl.isAbsolute(rel)) return false;
    return rel !== ".." && !rel.startsWith(".." + pathImpl.sep);
}
