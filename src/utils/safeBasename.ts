/**
 * 图片重命名文件名安全化（纯函数，可单测）：
 * 过滤 Windows 非法字符/控制字符/尾部点号，并拦截 Windows 保留设备名。
 * 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）即使带扩展名也非法（如 CON.png），
 * 且大小写不敏感；此前未拦截时 rename 失败仅表现为无差别错误提示。
 */

const WINDOWS_RESERVED_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 返回安全化后的 basename；非法/保留名/清空后为空时返回空串（调用方拒绝并提示） */
export function sanitizeBasename(name: string): string {
    const cleaned = name
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
        .replace(/\.+$/, "")
        .trim();
    if (cleaned === "") return "";
    // 保留名判定取第一个点之前的部分（扩展名不影响，CON.png 同样非法）
    const stem = cleaned.split(".")[0];
    if (WINDOWS_RESERVED_STEM.test(stem)) return "";
    return cleaned;
}
