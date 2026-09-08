/**
 * 请求-响应关联纯逻辑（无 DOM 依赖，可单测）：
 * pending 回调表 + settled 双保险 + 超时结算，统一宿主请求（重命名/项目图库/图片上传）
 * 的重复样板。回归背景：此前三处各自手写同一套 settled/timer/map 逻辑且不一致——
 * 图片选择器内联版无超时兜底（Extension 不响应时永久 Loading）、id 无随机后缀
 * （同毫秒两次请求互相覆盖槽位）。
 */

export interface PendingCallbacks<T> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

export type PendingTimeout<T> =
    | { kind: "resolve"; value: T }
    | { kind: "reject"; error: string };

export interface PendingHandle<T> {
    id: string;
    promise: Promise<T>;
    /** 取消并结算（默认 reject "Cancelled"，可带原因）——Promise 保证终局 */
    cancel: (reason?: string) => void;
}

export class PendingRequestRegistry<T> {
    private readonly _pending = new Map<string, PendingCallbacks<T>>();

    constructor(private readonly idPrefix: string) {}

    /** 登记一个 in-flight 请求：注册回调、挂超时；调用方随后发送消息 */
    begin(opts: { timeoutMs: number; timeout: PendingTimeout<T> }): PendingHandle<T> {
        const id = `${this.idPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let settleResolve: ((value: T) => void) | null = null;
        let settleReject: ((error: Error) => void) | null = null;

        const promise = new Promise<T>((resolve, reject) => {
            settleResolve = resolve;
            settleReject = reject;
            timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                this._pending.delete(id);
                if (opts.timeout.kind === "resolve") {
                    resolve(opts.timeout.value);
                } else {
                    reject(new Error(opts.timeout.error));
                }
            }, opts.timeoutMs);
            this._pending.set(id, {
                resolve: (value) => {
                    if (settled) return;
                    settled = true;
                    if (timeoutId !== null) clearTimeout(timeoutId);
                    resolve(value);
                },
                reject: (error) => {
                    if (settled) return;
                    settled = true;
                    if (timeoutId !== null) clearTimeout(timeoutId);
                    reject(error);
                },
            });
        });

        return {
            id,
            promise,
            cancel: (reason = "Cancelled") => {
                if (settled) return;
                settled = true;
                if (timeoutId !== null) clearTimeout(timeoutId);
                this._pending.delete(id);
                settleReject?.(new Error(reason));
            },
        };
    }

    /** 回包结算（成功）：删除槽位并 resolve */
    resolve(id: string, value: T): void {
        const cb = this._pending.get(id);
        if (cb) {
            this._pending.delete(id);
            cb.resolve(value);
        }
    }

    /** 回包结算（失败）：删除槽位并 reject（error 为展示给用户的文案） */
    reject(id: string, error: string): void {
        const cb = this._pending.get(id);
        if (cb) {
            this._pending.delete(id);
            cb.reject(new Error(error));
        }
    }
}
