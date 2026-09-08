import type { PathSuggestionItem } from "../../shared/messages";
import { PATH_SUGGESTION_TIMEOUT_MS } from "../../shared/constants";
import { PendingRequestRegistry, type PendingHandle } from "./pendingRequest";

/**
 * 路径补全请求总线（回归 P4/C4）。
 *
 * 此前两个消费者（正文路径链接 `pathLink/pathComplete.ts`、图片路径
 * `imageView/imgPathComplete.ts`）各自手写「Map + 手写 id + 手写 setTimeout 清理」，
 * 与 PendingRequestRegistry 是同一套逻辑的第三、第四份实现；index.ts 收到
 * pathSuggestions 回包还要分发给两个注册表各查一遍。
 *
 * 统一为单一注册表 + 单一回包入口：id 前缀只用于诊断，回包按 id 结算。
 */
const _registry = new PendingRequestRegistry<PathSuggestionItem[]>("path");

/** 登记一次补全请求；调用方随后 `notifyGetPathSuggestions(handle.id, query)` */
export function beginPathSuggestionRequest(): PendingHandle<PathSuggestionItem[]> {
    return _registry.begin({
        timeoutMs: PATH_SUGGESTION_TIMEOUT_MS,
        timeout: { kind: "reject", error: "path suggestion timeout" },
    });
}

/** 回包结算（index.ts 收到 pathSuggestions 时调用，唯一分发点） */
export function resolvePathSuggestionRequest(id: string, items: PathSuggestionItem[]): void {
    _registry.resolve(id, items);
}
