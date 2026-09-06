# Spec：表格换行模式（CSS 三档 + Shift+Enter 软换行）

> 创建日期：2026-09-04
> 状态：实施中
> 归属：v1.2 批次二（roadmap 已有条目；用户决策：两者结合）

## 需求范围

1. **Shift+Enter 软换行**：表格单元格内按 Shift+Enter 插入换行（hardbreak，序列化为 `<br>`），不再跳转到下一单元格
2. **CSS 换行三档**（`epytor.tableWrapMode`）：控制单元格内长文本的自动换行行为

## 现状（已实证，2026-09-04）

- 官方 `tableKeymap` 将单元格内 `Enter`/`Shift-Enter` 均绑定 `goToNextCell`（跳转下一单元格），无软换行能力
- `table_cell` schema 支持 `hardbreak` 节点；序列化时单元格内 hardbreak 输出 `<br>`

## 交互边界

- **Shift+Enter**：仅在光标位于 `table_cell`/`table_header` 内时拦截并插入 hardbreak；其他位置放行默认行为（splitBlock）。插件优先级高于官方 tableKeymap（注册顺序在后）
- **tableWrapMode 三档**：
  - `normal`（默认）：CJK 文字不拆字断行（`word-break: keep-all`），长英文单词/URL 允许断行（`overflow-wrap: break-word`）
  - `aggressive`：任意字符处断行（`word-break: break-all`），适合长 URL/代码片段
  - `none`：不换行（`white-space: nowrap`），表格横向溢出滚动
- 配置热更新：沿用现有配置注入机制（`:root` CSS 变量，`_getHtmlForWebview` 按枚举计算 `--epytor-table-word-break` / `--epytor-table-white-space`）
- 换行模式只影响表格单元格（th/td），不影响表头对齐、单元格手柄等其他表格样式

## 验收标准

- [ ] 单元格内 Shift+Enter 插入换行，序列化含 `&#10;`（2026-09-07 实证调整：remark-gfm 解析层丢弃 `<br>`，实体往返一致），光标留在单元格内
- [ ] 单元格外 Shift+Enter 行为不变（段落分裂）
- [ ] 三档切换后单元格换行行为符合预期（含 CJK/长英文/URL 场景）
- [ ] 表头行同样支持软换行与三档样式
- [ ] 回归测试：Shift+Enter 插 hardbreak 的序列化断言（修复前失败、修复后通过）
