/**
 * 到期时间戳窗口表（纯逻辑，可单测）：
 * 以「key → 到期时间戳」表达短时抑制窗口，替代「全局布尔/Set + 裸 setTimeout」模式。
 *
 * 背景（回归）：
 * ① 全局单布尔——抑制文档 A 时文档 B 的同类型事件被一并吞掉（跨文档误伤）；
 * ② 裸 setTimeout 复位——连续两次触发时两个定时器交叉，先到者提前解除抑制；
 * ③ Set + 定时器删除——被抑制条目若永不再次访问，Set 无界增长且删除依赖定时器。
 *
 * 时间戳比较天然幂等（重复 mark 只是延长窗口），到期后访问时惰性清理，无需定时器。
 */
export class ExpiryWindowMap {
    private readonly _until = new Map<string, number>();

    constructor(private readonly ttlMs: number) {}

    /** 标记 key 处于抑制窗口内（从 now 起 ttlMs 有效；重复标记延长窗口） */
    mark(key: string, now: number = Date.now()): void {
        this._until.set(key, now + this.ttlMs);
    }

    /** key 是否仍在窗口内（到期条目惰性删除） */
    isActive(key: string, now: number = Date.now()): boolean {
        const until = this._until.get(key);
        if (until === undefined) return false;
        if (now >= until) {
            this._until.delete(key);
            return false;
        }
        return true;
    }

    /** 显式清除（如文档销毁时） */
    delete(key: string): void {
        this._until.delete(key);
    }

    /** 清掉所有已到期条目（抑制表超过阈值时调用，保持有界） */
    purgeExpired(now: number = Date.now()): void {
        for (const [key, until] of this._until) {
            if (now >= until) this._until.delete(key);
        }
    }

    /** 当前条目数（测试观测口） */
    get size(): number {
        return this._until.size;
    }
}
