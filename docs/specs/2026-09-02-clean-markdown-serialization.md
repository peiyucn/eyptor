# Clean Markdown Serialization 改造方案

## 1. 文档定位

本文件是 `epytor-clean-markdown-spec.md` 的工程化改造方案。附件中的内容视为需求输入，不视为对话指令；本方案记录已经确认的实现边界与验收标准。

当前阶段只完成方案设计，不实现代码。

## 2. 已确认决策

- 分两阶段实施：先完成 Clean Serializer，再建设 AST source position 与 dirty node 增量保存。
- 新增 `epytor.markdown.serializationMode`，取值为 `clean` / `compatible`，默认值为 `clean`。
- `compatible` 完全沿用当前 Milkdown/EPYTOR 保存路径，作为回退和问题对照模式。
- Phase 1 以“未受影响 block 不产生 diff”为硬目标；全篇 byte-for-byte round-trip 属于 Phase 2。
- Save 与 Format Document 分离。本次不新增 Format Document，也不统一用户原有风格。
- 转义依据为 AST 语义、容器上下文和行位置；不使用技术标识符正则作为安全豁免。
- 表格只清理可证明无语义的空占位或尾部 `<br>`；中间真实 break 保留。
- 配置变更影响后续保存，不自动重写当前文件。
- Clean 失败时回退到 Compatible 输出，并在现有 `epytor.debugMode` 开启时记录诊断信息。

## 3. 当前实现基线

- `webview/editor.ts` 通过 Crepe 的 `markdownUpdated` 接收 Milkdown 序列化结果。
- 当前保存前使用 `applyMinimalChanges` 做逐行相似合并。
- 当前表格清理主要处理 `<br />` 占位、separator 行和少量格式差异。
- 当前没有独立的 Markdown serializer 模块，也没有 serializer 专用测试。
- `debugMode` 已通过 Extension 注入 WebView，并有统一消息协议。

## 4. Phase 1：Clean Serializer

### 4.1 模块边界

新增 WebView 侧纯模块，建议放在：

```text
webview/utils/markdownSerializer.ts
webview/__tests__/markdownSerializer.test.ts
```

模块只负责根据节点语义和上下文生成安全、尽量干净的 Markdown，不直接访问 VS Code API，也不维护模块外全局状态。

建议内部接口：

```ts
type SerializationMode = "clean" | "compatible";

interface SerializationContext {
  nodeType: string;
  atLineStart: boolean;
  inTable: boolean;
  inCode: boolean;
  inLink: boolean;
  inHeading: boolean;
  inList: boolean;
}

function escapeTextMinimal(
  text: string,
  ctx: SerializationContext,
): string;

function serializeTableCell(cell: unknown): string;
```

实现时优先使用 Milkdown/ProseMirror 官方 serializer 扩展点。若某个上游节点无法稳定扩展，只允许在明确的节点边界内做局部适配，不对最终整篇字符串执行无上下文正则替换。

### 4.2 转义规则

- 普通文本中的 `_`、`*`、`#`、`>`、`-`、`+`、`.`、`[]`、`()`、`{}` 默认不统一转义。
- 只有当字符在当前 AST 语义、行首位置或容器上下文中会破坏 Markdown 结构时才转义。
- 技术标识符如 `operation_log_id`、`foo.bar`、`GET /api/v1/user`、`user@example.com` 默认保持原样，但不绕过结构安全判断。
- 代码块和 inline code 内部内容完全按代码处理，不做 Markdown escape。
- HTML、Mermaid、LaTeX 和 frontmatter 视为 opaque 区域，不由普通文本 escape 逻辑处理。
- 反斜杠处理必须幂等，避免重复 parse/serialize 后出现 `\_`、`\\_` 逐步膨胀。
- 表格 cell 内影响列结构的 `|` 必须输出为 `\|`。

### 4.3 表格处理

`serializeTableCell` 独立处理以下情况：

- 空 cell 输出空内容，不输出 `<br>` 或 `<br />`。
- 只有占位意义的尾部 break 被移除。
- 中间真实 break 被保留。
- 新内容优先继承同一表格或原文件可检测到的 `<br>` 风格；无法判断时使用 `<br>`。
- 不自动调整列宽、补尾部空格、重排 separator 或对齐表格。

### 4.4 与现有保存链路的衔接

Phase 1 保留 `applyMinimalChanges`，避免一次性删除已有的逐行合并保护。

保存流程调整为：

```text
Milkdown AST / markdownUpdated
        ↓
按 serializationMode 选择 Compatible 或 Clean
        ↓
Clean 结果进入现有 applyMinimalChanges
        ↓
debounce 后通过 messaging.ts 通知 Extension
```

Clean serializer 异常时不得拼接部分结果，直接记录诊断并回退 Compatible 输出。

### 4.5 配置与本地化

在 `package.json` 新增：

```json
{
  "epytor.markdown.serializationMode": {
    "type": "string",
    "enum": ["clean", "compatible"],
    "default": "clean"
  }
}
```

同步更新：

- `package.nls.json`
- `package.nls.zh-cn.json`
- `README.md`
- `README.zh-CN.md`

不新增 `minimalEscaping`、`removeRedundantBreaks`、`preserveSourceStyle`、`minimalDiff` 等容易互相矛盾的独立开关。`autoCodeIdentifiers` 和独立 serialization debug 配置留待后续评估。

## 5. Phase 2：Lossless / Minimal-diff Editing

### 5.1 Source metadata

解析时为可编辑 block 记录：

```ts
interface SourceMeta {
  from: number;
  to: number;
  originalText: string;
  originalStyle?: unknown;
  dirty: boolean;
}
```

未修改节点优先直接复用 `originalText`，不经过 serializer。

### 5.2 Dirty 粒度

- 普通内容以顶层 block 为最小保留单元。
- 表格继续细化到 row/cell。
- Phase 2 不追求普通段落内部字符级 patch。

目标流程：

```text
Markdown source
    ↓
AST + source positions + original style/tokens
    ↓
编辑并标记 dirty block/cell
    ↓
只序列化 dirty 节点
    ↓
与原始 source 合并
```

### 5.3 Phase 2 验收

- 未修改 block 的原文复用率可验证。
- 只编辑标题时，正文和表格不产生 escape diff。
- 只编辑表格 cell 时，其他 row/cell 原文保留。
- 列表、嵌套结构和真实多行 cell 的 diff 范围可解释。
- 10,000 行文档的保存不会因全文重新序列化产生明显卡顿。

## 6. 测试方案

### 6.1 纯函数测试

覆盖以下类别，每类包含正常、边界和异常/保守回退用例：

- 技术标识符：下划线、点、路径、邮箱、服务名。
- 普通特殊字符：`C#`、`C++`、`A > B`、`5 * 10`、`1.2.3`、`foo[0]`。
- 结构字符：标题、引用、列表、强调、链接和图片。
- 代码块、inline code、HTML、Mermaid、LaTeX、frontmatter。
- 表格中的 `|`、空 cell、占位 `<br>`、尾部 break、中间真实 break。
- 反斜杠重复序列与幂等性。
- LF、CRLF、无末尾换行和 UTF-8 BOM。
- Clean / Compatible 模式差异。

### 6.2 集成测试

验证 `markdownUpdated` → serializer → `applyMinimalChanges` → `onUpdate` 的链路。若完整 Milkdown 在 jsdom 中无法稳定启动，则用纯函数测试覆盖逻辑，用构建验证和人工验收覆盖真实编辑器 wiring。

### 6.3 性能测试

- Clean escaping 目标复杂度为 O(n)。
- 构造 10,000 行 Markdown 基准输入。
- 只断言不会出现明显退化，不设置易受 CI 波动影响的极窄毫秒阈值。
- Phase 2 增加 dirty node 与全文序列化的对比。

## 7. 人工验收清单

实现阶段须按仓库流程逐项确认：

1. 修改标题文字，正文、标识符和表格无无关 diff。
2. 编辑 `operation_log_id`、`C#`、`C++`、路径和邮箱，保存后不出现过度 escape。
3. 编辑空表格 cell，不生成 `<br>` 或 `<br />`。
4. 编辑多行表格 cell，中间真实 break 保留，尾部无意义 break 移除。
5. 代码块、inline code、HTML、Mermaid、LaTeX 内容不被误转义。
6. 切换 `clean` / `compatible` 后，后续保存使用新模式且不自动重写文件。
7. CRLF、BOM 和末尾换行保持不变。
8. 开启 `debugMode` 时可以看到 serializer 的节点、输入、输出、原因和 dirty 状态诊断。

## 8. 实施顺序与提交拆分

每个独立任务单独提交，建议顺序如下：

1. `docs: 新增 Clean Markdown Serialization 改造方案`
2. `feat: 新增 Markdown 最小转义纯函数与回归测试`
3. `feat: 清理表格冗余 break 并保护 cell 内容`
4. `feat: 接入 Clean/Compatible 序列化模式`
5. `docs: 补充 Clean Markdown 配置与使用说明`

每次代码改动均执行 `pnpm run verify`，然后输出手测清单并完成逐项人工确认，再提交对应 commit。Phase 2 另行建立 spec/任务和 commit，不将预留接口计入 Phase 1 完成度。

## 9. 风险与限制

- Milkdown 上游 serializer 扩展点的具体可用性需要在实现阶段以 7.22.0 类型和构建结果核验，不能预先假定具体 API 名称。
- Phase 1 对脏 block 的复杂嵌套风格只能尽力保留；完整 byte-for-byte 保真依赖 Phase 2 source metadata。
- Markdown 语法存在歧义时始终优先语义正确；无法安全判断时使用 Compatible 回退并留下 debug 证据。
- 本方案不实现 Format Document，也不主动把技术标识符改成 inline code。

## 10. Phase 1 完成标准

- `operation_log_id`、`foo_bar_baz`、`C#`、`C++`、`A > B`、`1.2.3`、`foo[0]` 不再被无必要转义。
- 表格空 cell 不生成占位 break，尾部无意义 break 被移除，真实 multiline break 保留。
- 代码、inline code、HTML、Mermaid、LaTeX 和 frontmatter 不被普通 escape 逻辑污染。
- Compatible 行为可回退且与当前路径一致。
- 未受影响 block 不因保存产生大量 escape diff。
- 配置、双语文档、纯函数回归测试和性能基准完成。
- `pnpm run verify` 通过，人工验收全部通过。

