/**
 * Frontmatter 可编辑面板组件。
 * 职责：渲染 key/value 输入行 + 增删行，编辑防抖后回调 onChange(序列化 YAML 头)。
 * 面板重建（revert/init）时宿主应先 dispose 旧实例，避免旧防抖 timer 竞态写回旧值。
 */
import { parseFrontmatter, serializeFrontmatter, type FrontmatterEntry, type FrontmatterRow } from "@/utils/frontmatter";
import { t } from "@/i18n";

export interface FrontmatterPanelHandle {
    panel: HTMLElement;
    /** 面板已从文档移除（无 frontmatter 时不创建，handle 为 null） */
    dispose(): void;
}

const SAVE_DEBOUNCE_MS = 300;

export function createFrontmatterPanel(
    frontmatter: string,
    onChange: (serialized: string) => void,
): FrontmatterPanelHandle | null {
    const parsed = parseFrontmatter(frontmatter);
    if (!parsed.some((entry) => entry.type === "kv")) return null;

    /**
     * 条目数组（源真相）：kv 行对应一个可编辑 DOM 行；raw 行不渲染、只随序列化
     * 原位放回。删除 kv 行时置 null 保序（DOM 行以 dataset.fmIndex 关联条目下标，
     * splice 会错位后续行）。
     */
    const entries: (FrontmatterEntry | null)[] = [...parsed];

    const panel = document.createElement("div");
    panel.id = "frontmatter-panel";
    panel.className = "frontmatter-panel";
    const table = document.createElement("table");
    table.className = "frontmatter-table";
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    panel.appendChild(table);

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const clearTimer = () => {
        if (saveTimer !== null) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
    };

    /** 按 DOM 顺序收集 kv 行并回写源条目（raw 行不在 DOM 中，位置天然保留） */
    const collectRows = (): FrontmatterRow[] => {
        const rows: FrontmatterRow[] = [];
        tbody.querySelectorAll<HTMLTableRowElement>("tr.fm-row").forEach((tr) => {
            const keyInput = tr.querySelector<HTMLInputElement>(".fm-key-input");
            const valueInput = tr.querySelector<HTMLInputElement>(".fm-val-input");
            const key = keyInput?.value ?? "";
            const value = valueInput?.value ?? "";
            rows.push({ key, value });
            const index = Number(tr.dataset.fmIndex ?? -1);
            if (index >= 0) {
                entries[index] = { type: "kv", key, value };
            }
        });
        return rows;
    };

    const serializeEntries = (): string => {
        const valid = entries.filter((entry): entry is FrontmatterEntry => entry !== null);
        return serializeFrontmatter(valid);
    };

    /**
     * 校验并标记错误行：value 已填但 key 为空的行写盘时会被过滤（用户感知为
     * 「加行无效」）；返回 false 表示存在待补 key 的行，该行 key 框红框高亮并聚焦。
     */
    const validateRows = (rows: FrontmatterRow[]): boolean => {
        let valid = true;
        const rowEls = tbody.querySelectorAll<HTMLTableRowElement>("tr.fm-row");
        rows.forEach((row, index) => {
            const keyInput = rowEls[index]?.querySelector<HTMLInputElement>(".fm-key-input");
            const emptyKeyWithValue = row.key.trim() === "" && row.value.trim() !== "";
            keyInput?.classList.toggle("fm-key-input--error", emptyKeyWithValue);
            if (emptyKeyWithValue) {
                valid = false;
                if (document.activeElement !== keyInput) {
                    keyInput?.focus();
                }
            }
        });
        return valid;
    };

    const scheduleSave = () => {
        if (disposed) return;
        clearTimer();
        saveTimer = setTimeout(() => {
            saveTimer = null;
            if (disposed) return;
            const rows = collectRows();
            if (!validateRows(rows)) return;
            onChange(serializeEntries());
        }, SAVE_DEBOUNCE_MS);
    };

    /** 立即提交（输入框失焦 / 删除行 / 切换模式前）：防抖窗口内切走不丢改动 */
    const flushSave = () => {
        if (disposed) return;
        clearTimer();
        const rows = collectRows();
        if (!validateRows(rows)) return;
        onChange(serializeEntries());
    };

    const addRow = (key = "", value = "", entryIndex = -1): void => {
        const tr = document.createElement("tr");
        tr.className = "fm-row";
        tr.dataset.fmIndex = String(entryIndex);
        const keyTd = document.createElement("td");
        keyTd.className = "fm-key";
        const keyInput = document.createElement("input");
        keyInput.className = "fm-key-input";
        keyInput.value = key;
        keyInput.placeholder = "key";
        keyInput.spellcheck = false;
        const valTd = document.createElement("td");
        valTd.className = "fm-val";
        const valueInput = document.createElement("input");
        valueInput.className = "fm-val-input";
        valueInput.value = value;
        valueInput.placeholder = "value";
        valueInput.spellcheck = false;
        const delTd = document.createElement("td");
        delTd.className = "fm-del";
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "fm-del-btn";
        delBtn.textContent = "✕";
        delBtn.setAttribute("aria-label", t("Delete"));
        delBtn.addEventListener("click", () => {
            const index = Number(tr.dataset.fmIndex ?? -1);
            if (index >= 0) entries[index] = null; // 置空保序，raw 行位置不受影响
            tr.remove();
            flushSave();
        });
        delTd.appendChild(delBtn);
        keyTd.appendChild(keyInput);
        valTd.appendChild(valueInput);
        tr.append(keyTd, valTd, delTd);
        tbody.appendChild(tr);
        keyInput.addEventListener("input", scheduleSave);
        valueInput.addEventListener("input", scheduleSave);
        keyInput.addEventListener("blur", flushSave);
        valueInput.addEventListener("blur", flushSave);
        keyInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); valueInput.focus(); }
        });
        valueInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                appendRow();
                tbody.querySelector<HTMLInputElement>("tr:last-child .fm-key-input")?.focus();
            }
        });
    };

    /** 追加一行新的可编辑 kv 条目（用户主动新增，接在 raw 行之后） */
    const appendRow = (): void => {
        entries.push({ type: "kv", key: "", value: "" });
        addRow("", "", entries.length - 1);
    };

    for (const [index, entry] of entries.entries()) {
        if (entry?.type === "kv") addRow(entry.key, entry.value, index);
    }

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "fm-add-btn";
    addBtn.textContent = "+";
    addBtn.setAttribute("aria-label", t("Add"));
    // 阻止按钮在 mousedown 时夺取焦点并阻断冒泡（防 document 级监听抢焦点，
    // click 内显式转移焦点到新行）
    addBtn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
    addBtn.addEventListener("click", () => {
        appendRow();
        const keyInput = tbody.querySelector<HTMLInputElement>("tr:last-child .fm-key-input");
        // 聚焦新行 key 框：mousedown 的 preventDefault 已消除按钮夺焦的根因，
        // 同步 focus 即可（回归 P7：此前叠了「同步 + setTimeout(0) + rAF」三层保险，
        // 但从未定位到具体夺焦者；若实测仍被夺焦，再按定位到的原因补一层）
        keyInput?.focus();
    });
    panel.appendChild(addBtn);

    return {
        panel,
        dispose() {
            disposed = true;
            clearTimer();
            panel.remove();
        },
    };
}
