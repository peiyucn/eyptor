/**
 * Frontmatter 可编辑面板组件。
 * 职责：渲染 key/value 输入行 + 增删行，编辑防抖后回调 onChange(序列化 YAML 头)。
 * 面板重建（revert/init）时宿主应先 dispose 旧实例，避免旧防抖 timer 竞态写回旧值。
 */
import { parseFrontmatter, serializeFrontmatter, type FrontmatterRow } from "@/utils/frontmatter";
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
    const entries = parseFrontmatter(frontmatter);
    if (entries.length === 0) return null;

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

    const collectRows = (): FrontmatterRow[] => {
        const rows: FrontmatterRow[] = [];
        tbody.querySelectorAll<HTMLTableRowElement>("tr.fm-row").forEach((tr) => {
            const keyInput = tr.querySelector<HTMLInputElement>(".fm-key-input");
            const valueInput = tr.querySelector<HTMLInputElement>(".fm-val-input");
            rows.push({ key: keyInput?.value ?? "", value: valueInput?.value ?? "" });
        });
        return rows;
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
            onChange(serializeFrontmatter(rows));
        }, SAVE_DEBOUNCE_MS);
    };

    /** 立即提交（输入框失焦 / 删除行 / 切换模式前）：防抖窗口内切走不丢改动 */
    const flushSave = () => {
        if (disposed) return;
        clearTimer();
        const rows = collectRows();
        if (!validateRows(rows)) return;
        onChange(serializeFrontmatter(rows));
    };

    const addRow = (key = "", value = ""): void => {
        const tr = document.createElement("tr");
        tr.className = "fm-row";
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
                addRow();
                tbody.querySelector<HTMLInputElement>("tr:last-child .fm-key-input")?.focus();
            }
        });
    };

    for (const { key, value } of entries) {
        addRow(key, value);
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
        addRow();
        const keyInput = tbody.querySelector<HTMLInputElement>("tr:last-child .fm-key-input");
        // 三重聚焦保险：click 同步 + 下一宏任务 + 下一帧；任一环节焦点被夺回都能补回
        keyInput?.focus();
        setTimeout(() => {
            if (document.activeElement !== keyInput) {
                keyInput?.focus();
            }
        }, 0);
        requestAnimationFrame(() => {
            if (document.activeElement !== keyInput) {
                keyInput?.focus();
            }
        });
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
