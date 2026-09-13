import { describe, it, expect } from "vitest";
import * as path from "path";
import {
    CANDIDATE_IMAGE_DIRS,
    expandCandidateDirs,
    planImageLocalDir,
} from "../../src/utils/imageLocalDir";

describe("planImageLocalDir — 自定义 imageLocalPath", () => {
    const docDir = path.resolve("/ws/docs");
    const workspaceRoot = path.resolve("/ws");

    it("绝对路径 + 用户级配置 应该 直接使用", () => {
        const custom = path.resolve("/data/images");
        const plan = planImageLocalDir({
            customPath: custom,
            docDir,
            workspaceRoot,
            workspaceLevel: false,
        });

        expect(plan).toEqual({ kind: "fixed", dir: custom, downgraded: false });
    });

    it("相对路径 + 有工作区根 应该 拼到工作区根下", () => {
        const plan = planImageLocalDir({
            customPath: "static/images",
            docDir,
            workspaceRoot,
            workspaceLevel: false,
        });

        expect(plan).toEqual({
            kind: "fixed",
            dir: path.resolve(workspaceRoot, "static", "images"),
            downgraded: false,
        });
    });

    it("相对路径 + 无工作区根 应该 拼到文档目录下", () => {
        const plan = planImageLocalDir({
            customPath: "imgs",
            docDir,
            workspaceRoot: null,
            workspaceLevel: false,
        });

        expect(plan).toEqual({ kind: "fixed", dir: path.join(docDir, "imgs"), downgraded: false });
    });

    it("工作区级绝对路径越界 应该 降级 <文档目录>/images（回归：恶意仓库注入）", () => {
        const plan = planImageLocalDir({
            customPath: path.resolve("/outside/evil"),
            docDir,
            workspaceRoot,
            workspaceLevel: true,
        });

        expect(plan).toEqual({ kind: "fixed", dir: path.join(docDir, "images"), downgraded: true });
    });

    it("工作区级相对路径 ../ 逃逸 应该 降级", () => {
        const plan = planImageLocalDir({
            customPath: "../outside",
            docDir,
            workspaceRoot,
            workspaceLevel: true,
        });

        expect(plan).toEqual({ kind: "fixed", dir: path.join(docDir, "images"), downgraded: true });
    });

    it("工作区级路径指向工作区内 应该 放行", () => {
        const plan = planImageLocalDir({
            customPath: "assets/img",
            docDir,
            workspaceRoot,
            workspaceLevel: true,
        });

        expect(plan.kind === "fixed" && plan.downgraded).toBe(false);
    });

    it("用户级配置越界 应该 信任放行（用户自己的选择）", () => {
        const outside = path.resolve("/outside/mine");
        const plan = planImageLocalDir({
            customPath: outside,
            docDir,
            workspaceRoot,
            workspaceLevel: false,
        });

        expect(plan).toEqual({ kind: "fixed", dir: outside, downgraded: false });
    });

    it("非 file 文档（无文档目录）+ 相对路径 应该 返回空探测计划", () => {
        const plan = planImageLocalDir({
            customPath: "imgs",
            docDir: null,
            workspaceRoot: null,
            workspaceLevel: false,
        });

        expect(plan).toEqual({ kind: "probe", candidates: [], fallbackDir: null });
    });

    it("非 file 文档 + 绝对路径 应该 仍可使用", () => {
        const custom = path.resolve("/data/images");
        const plan = planImageLocalDir({
            customPath: custom,
            docDir: null,
            workspaceRoot: null,
            workspaceLevel: false,
        });

        expect(plan).toEqual({ kind: "fixed", dir: custom, downgraded: false });
    });
});

describe("planImageLocalDir — 自动探测", () => {
    it("无自定义路径 应该 展开两处候选并回落 <文档目录>/images", () => {
        const docDir = path.resolve("/ws/docs");
        const workspaceRoot = path.resolve("/ws");

        const plan = planImageLocalDir({
            customPath: "",
            docDir,
            workspaceRoot,
            workspaceLevel: false,
        });

        expect(plan.kind).toBe("probe");
        if (plan.kind === "probe") {
            expect(plan.candidates).toEqual(expandCandidateDirs([workspaceRoot, docDir]));
            expect(plan.fallbackDir).toBe(path.join(docDir, "images"));
        }
    });

    it("无工作区根时 应该 只探测文档目录候选", () => {
        const docDir = path.resolve("/ws/docs");
        const plan = planImageLocalDir({
            customPath: "",
            docDir,
            workspaceRoot: null,
            workspaceLevel: false,
        });

        expect(plan.kind === "probe" && plan.candidates).toEqual(expandCandidateDirs([docDir]));
    });

    it("非 file 文档无自定义路径 应该 没有可用目录", () => {
        const plan = planImageLocalDir({
            customPath: "",
            docDir: null,
            workspaceRoot: null,
            workspaceLevel: false,
        });

        expect(plan).toEqual({ kind: "probe", candidates: [], fallbackDir: null });
    });
});

describe("expandCandidateDirs", () => {
    it("应该 按 root 优先序 × 候选目录顺序展开", () => {
        const dirs = expandCandidateDirs(["/a", "/b"]);

        expect(dirs.slice(0, CANDIDATE_IMAGE_DIRS.length)).toEqual(
            CANDIDATE_IMAGE_DIRS.map((d) => path.join("/a", d)),
        );
        expect(dirs.length).toBe(CANDIDATE_IMAGE_DIRS.length * 2);
    });

    it("root 相同时 应该 去重", () => {
        const dirs = expandCandidateDirs(["/a", "/a"]);

        expect(dirs.length).toBe(CANDIDATE_IMAGE_DIRS.length);
    });

    it("null/空 root 应该 跳过", () => {
        expect(expandCandidateDirs([null, "/a"])).toEqual(expandCandidateDirs(["/a"]));
    });
});
