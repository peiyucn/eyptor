/**
 * 拉取式保存的 in-flight 内容请求协调器（纯逻辑，无 VSCode 依赖，可单测）。
 *
 * 背景（回归）：旧实现用「每文档单槽」Map 保存等待者，并发拉取（Cmd+S / files.autoSave /
 * watcher 回退 / frontmatter 更新 / 切文本编辑器）时后到者覆盖前者的 resolver，被覆盖的
 * 保存承诺永不 resolve（保存悬挂、内容未写盘且零提示）；超时兜底还会按 key 误删后到者
 * 的槽位，使其永远等不到回包。
 *
 * 语义：同一 uriKey 的并发请求单飞——只发一次 send，所有等待者共享同一回包；
 * 超时 / 面板销毁时以首个请求者携带的兜底内容结算全部等待者，保证每个 Promise 终局。
 */

interface PendingRequest {
    resolvers: Array<(content: string) => void>;
    fallbackContent: string;
    timer: ReturnType<typeof setTimeout>;
}

export class ContentRequestCoordinator {
    private readonly _pending = new Map<string, PendingRequest>();

    constructor(
        private readonly send: (uriKey: string) => void,
        private readonly timeoutMs: number,
        /** 超时兜底触发时的回调（保存仍以兜底内容完成，回调用于用户可见警告） */
        private readonly onTimeout?: (uriKey: string) => void,
    ) {}

    /** 是否有 in-flight 请求（回包到达时先查，避免无谓的内容预处理） */
    has(uriKey: string): boolean {
        return this._pending.has(uriKey);
    }

    /** 请求最新内容：已有 in-flight 请求时排队复用（单飞），兜底内容取首个请求者 */
    request(uriKey: string, fallbackContent: string): Promise<string> {
        const pending = this._pending.get(uriKey);
        if (pending) {
            return new Promise((resolve) => pending.resolvers.push(resolve));
        }
        return new Promise((resolve) => {
            const entry: PendingRequest = {
                resolvers: [resolve],
                fallbackContent,
                timer: setTimeout(() => {
                    this._settle(uriKey, entry.fallbackContent);
                    this.onTimeout?.(uriKey);
                }, this.timeoutMs),
            };
            this._pending.set(uriKey, entry);
            this.send(uriKey);
        });
    }

    /** 收到回包：结算该 uriKey 的全部等待者 */
    resolve(uriKey: string, content: string): void {
        this._settle(uriKey, content);
    }

    /** 面板销毁兜底：以兜底内容结算，防止保存承诺悬挂 */
    settleAll(uriKey: string): void {
        const entry = this._pending.get(uriKey);
        if (!entry) return;
        this._settle(uriKey, entry.fallbackContent);
    }

    private _settle(uriKey: string, content: string): void {
        const entry = this._pending.get(uriKey);
        if (!entry) return;
        this._pending.delete(uriKey);
        clearTimeout(entry.timer);
        for (const resolver of entry.resolvers) resolver(content);
    }
}
