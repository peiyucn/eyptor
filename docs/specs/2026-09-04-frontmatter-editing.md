# Spec：Frontmatter 可编辑面板

> 创建日期：2026-09-04
> 状态：已实现（v1.2.0，2026-09-13）
> 归属：v1.2 批次二（借鉴功能预评估：官方无 frontmatter feature，低风险，正路可行）

## 需求范围

把现有只读 frontmatter 面板（`webview/index.ts` `renderFrontmatterPanel`）升级为可编辑：key/value 输入框 + 行增删，编辑实时写回文档头部；不需要切到源码模式改 YAML。

## 交互边界

- **编辑**：每行 key 输入框 + value 输入框（始终可见，点击即编辑）；行尾删除按钮；面板底部「+」添加行
- **保存时机**：编辑防抖 300ms → 序列化 → `frontmatterUpdate` 消息 → Extension 更新 `_frontmatterMap` 并走现有保存链路（`restoreContentForSave`）
- **删除语义**：全部行删除 → frontmatter 为空 → 保存后文档无 YAML 头；面板隐藏
- **序列化（v1 简单模式）**：每行 `key: value` 原样写出（含引号/特殊字符的值由用户自行维护引号）；空 key 的行忽略。嵌套结构/列表字段为后续版本（友商 0.3.2 能力，暂不做）
- **消息协议**：新增 ToExtensionMessage `{ type: "frontmatterUpdate"; frontmatter: string }`；Extension 侧用 `document.getText()` 提取 body 重组保存（与编辑器正文保存共用 `_scheduleAutoSaveOrMarkDirty`）
- **无 frontmatter 时**：面板不显示；用户如需添加，在源码模式加头（或后续版本做空面板入口——不在本版）

## 验收标准

- [ ] 编辑 key/value 后保存，源码文件 YAML 头同步更新；正文不受影响
- [ ] 添加/删除行正确；删除全部行后 YAML 头消失
- [ ] 含引号、冒号、URL 的值原样保留（简单模式）
- [ ] 切换文本编辑器/预览往返，面板状态与文件一致
- [ ] 序列化纯函数单元测试：往返、空行过滤、引号值、无行 → 空串
- [ ] revert（外部文件变更）后面板刷新
