# Skill Creator 会话入口设计

## 文档类型

- 产品与实现联合设计文档
- 范围：技能面板 `创建技能` 入口、conversation 创建方式、composer 初始 skill 挂载、placeholder 文案、与现有 `skills service` 的关系

## 背景

当前“创建技能”主要仍然沿用资源库弹框思路，前端入口位于技能面板，但交互重心是 `ResourceCreateModal`。这条路径的问题很直接：

- 用户点击的是“技能面板中的创建技能”，得到的却是“资源库表单式创建”
- 技能创建过程与正常 conversation 脱节，无法复用现有聊天心智
- 产品语义容易滑向“专用 workflow 页面 / 专用状态机 / 专用 tab”，复杂度明显过高
- 现有系统实际上已经具备 `conversation + canvas chat tab + skill 挂载 + skills service` 的主干能力，没有必要再维护第二套创建交互

本设计的目标不是再造一个“技能创建器”，而是把“创建技能”降维成一个更自然的动作：

- 用户点击“创建技能”
- 系统创建一个普通 conversation
- 初始自动挂载 `skill-creator`
- 用户像普通对话一样描述需求
- 最终结果仍然落到现有 skills 目录

也就是说，`创建技能` 在产品上不再是“打开一个特殊工具”，而是“打开一个预挂载了 skill 的普通对话”。

## 目标

### 产品目标

- 让“创建技能”看起来像普通对话，而不是表单或向导
- 保留 `skill-creator` 的可见性，让用户明确知道当前挂载了哪个 skill
- 降低新手理解成本，不要求用户手动输入 `/skill-creator`
- 在 skill 被移除后，让会话自然退化回普通聊天

### 工程目标

- 复用现有 `conversation + canvas chat tab + composer chip + skills service` 主链路
- 不新增 workflow tab type
- 不新增持久化 workflow 状态
- 不把 `skill-creator` 作为会话长期身份
- 让实现尽量停留在 renderer 侧的一次性注入，不污染 conversation schema

## 非目标

- 不做专用 `Skill Creator` 页面壳子
- 不做专用 workflow 状态机
- 不做“创建技能”固定标题会话
- 不做中间草稿目录落盘
- 不做“过程状态文件”持久化
- 不把 `/skill-creator` 作为输入框中的真实文本预填
- 不在会话重新打开后恢复初始 `skill-creator` chip

## 核心设计结论

### 1. “创建技能”入口改为创建普通 conversation

技能面板中的 `创建技能` 点击后：

- 不再打开 `ResourceCreateModal`
- 在当前工作区创建一个普通 conversation
- conversation 标题继续走现有默认逻辑
- 创建成功后直接打开该 conversation

这意味着“创建技能”不再被建模为特殊页面或特殊会话类型，而只是“普通会话的一个特殊起手动作”。

### 2. `skill-creator` 只作为一次性初始挂载

新建会话打开后，composer 自动注入一个 `skill-creator` chip。

这里必须明确两个约束：

- 这个 chip 是可见的，展示规则与普通 skill chip 保持一致
- 这个 chip 不是 conversation 的持久属性，只是一次性初始注入

也就是说：

- 首次进入时自动出现
- 用户可手动移除
- 关闭会话后重新打开，不恢复

这不是“预置一个专用创建技能会话”，而是“起手帮用户挂一个 skill”。

### 3. `skill-creator` chip 完全按普通 skill chip 处理

`skill-creator` 的显示与交互不做特殊命名包装：

- 显示名保持和现有技能挂载规则一致
- 样式复用现有 composer resource chip
- 用户可以点击删除

不做以下特殊处理：

- 不改名为“创建技能”
- 不做双语标签
- 不做不可移除固定 chip

产品上它就是一个普通 skill，只是由入口自动帮用户挂上。

### 4. placeholder 跟随 chip 状态变化

当 composer 中存在 `skill-creator` chip 时，placeholder 改为更友好的技能创建引导语：

```text
输入你想创建的技能内容，Kite 会帮你创建一个技能
```

当 `skill-creator` chip 被移除后：

- placeholder 恢复默认文案
- 该 conversation 从交互上完全回到普通聊天

这里不使用“输入框真实预填 `/skill-creator`”方案，因为那样会直接吞掉 placeholder，也会把产品体验拉回命令式交互。

### 5. 中间过程只存在 conversation，最终结果再落 skills 目录

本设计采用如下真源划分：

- conversation：创建过程真源
- skills 目录：最终资产真源

规则：

- 用户讨论、来回修改、澄清需求，都只保存在 conversation 中
- 不创建中间草稿技能目录
- 不维护流程状态文件
- 最终确认创建成功时，才通过现有 `skills service` 把结果写入当前技能目录体系

这条决策必须保留，不得回退到“中间过程也持续写技能目录”的方案。半成品不应污染技能资产库。

## 交互流程

### 用户路径

1. 用户在技能面板点击 `创建技能`
2. 系统在当前工作区创建一个普通 conversation
3. 系统打开该 conversation，并在 composer 中一次性注入 `skill-creator` chip
4. composer 显示技能创建引导 placeholder
5. 用户直接输入自然语言描述想创建的技能
6. 发送时，composer 将 `skill-creator` 与用户输入一起组成最终消息
7. 用户可在发送前或发送后移除 `skill-creator` chip
8. 若移除，该 conversation 后续完全按普通聊天处理
9. 当技能最终创建成功时，由现有链路将结果落到 skills 目录

### 关闭再打开

如果用户在首次打开后关闭 conversation，再重新打开：

- 不恢复自动注入的 `skill-creator` chip
- 不恢复技能创建专属 placeholder
- 会话按普通 conversation 展示

这是有意设计，不是遗漏。`skill-creator` 是一次性入口辅助，不是持久会话身份。

## 实现设计

### A. 不修改 conversation 持久化模型

本设计不建议给 conversation 增加 `presetSkill`、`workflow`、`skillCreation` 等持久化字段。

原因：

- 用户明确要求这只是普通 conversation
- `skill-creator` 可以被移除
- 一旦持久化，会与“关闭再打开不恢复”直接冲突
- 这会把一次性 UI 起手动作错误升级为会话身份

结论：

- conversation service / schema 不承担这次初始 skill 注入状态
- 注入状态只保存在 renderer 侧的一次性会话打开流程里

### B. 需要新增“一次性 chip 注入”能力，而不是复用“插文本”

当前已有的 `composer.store` 更接近“一次性插文本请求”，适合插入 `/创建技能` 这类字符串，但不适合本设计。

本设计需要的是：

- 不是插入文本
- 而是向特定 conversation 的 InputArea 注入一个初始选中 chip

因此 renderer 侧需要新增一个轻量机制，例如：

- 为特定 `conversationId` 排队一个一次性 `SelectedComposerResourceChip`
- `InputArea` 在首次渲染该 conversation 时消费它
- 消费后立即清除，不再保留

这条链路要满足两个条件：

- 只对目标 `conversationId` 生效
- 只消费一次

### C. `InputArea` 负责三件事

`InputArea` 需要支持以下行为：

1. 消费一次性初始 chip 注入请求
2. 把 `skill-creator` 与已有 `selectedResourceChips` 放在同一渲染体系里
3. 根据是否存在 `skill-creator` chip 决定 placeholder

具体规则：

- 如果当前 `selectedResourceChips` 中存在 `token === '/skill-creator'`
  - 使用技能创建引导 placeholder
- 否则
  - 使用默认 placeholder

这样不需要新建专用 input 组件，也不需要给 `ChatTabViewer` 增加复杂壳子。

### D. 入口动作应落在 renderer 会话创建动作里

技能面板点击 `创建技能` 后，renderer 侧动作顺序应固定为：

1. 创建普通 conversation
2. 打开该 conversation
3. 为该 `conversationId` 注册一次性 `skill-creator` chip 注入

建议不要拆到主进程做，因为这不是持久化语义，而是 UI 侧起手行为。

### E. 最终落盘继续复用现有 skills service

本设计不替换最终技能落盘能力，仍然依赖现有技能创建能力完成：

- 由现有 `skill-creator` skill / agent 流程完成产物生成
- 由现有 `skills service` 完成最终写入 skills 目录

本设计只改“入口方式”和“起手交互”，不重写技能创建底层产出链路。

## 文件影响范围

### 需要修改

- `src/renderer/components/home/ExtensionsView.tsx`
  - 把“创建技能”从打开 `ResourceCreateModal` 改成创建普通 conversation 并打开
- `src/renderer/stores/chat.store.ts`
  - 增加“创建技能 conversation”动作，串起创建会话、打开会话、注册一次性 chip 注入
- `src/renderer/stores/composer.store.ts`
  - 从“仅支持插文本”扩展为“支持一次性 chip 注入”或新增并行轻量机制
- `src/renderer/components/chat/InputArea.tsx`
  - 消费一次性 chip 注入
  - 根据 `skill-creator` chip 状态切换 placeholder
- `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`
  - 将 placeholder 透传改为可根据 conversation 场景定制，或直接让 `InputArea` 内部完成判定

### 停止作为主流程使用

- `src/renderer/components/resources/ResourceCreateModal.tsx`
  - 第一阶段不一定删除文件，但不再作为技能创建主入口

### 原则上不应修改

- `src/main/services/conversation.service.ts`
- `src/main/controllers/conversation.controller.ts`
- `src/main/ipc/conversation.ts`

原因：本设计不需要为 conversation 增加持久化 schema，只需要普通创建能力。

## 风险与约束

### 1. 一次性注入时序

如果先打开 conversation，后注入 chip，而 `InputArea` 尚未挂载或已经错过消费时机，可能导致首屏没有出现 `skill-creator`。

因此实现上必须保证：

- 注入请求按 `conversationId` 定向
- `InputArea` 初次进入时可以稳定消费
- 消费后立即清除，避免串到别的 conversation

### 2. 不要把“可移除 chip”重新做成“隐藏持久 preset”

这是最容易犯的错。  
只要用户可移除，就不能把它设计成会话身份；否则用户删掉后再次打开又回来，交互会自相矛盾。

### 3. placeholder 切换必须只看当前 chip 状态

placeholder 的判断逻辑不能看“入口来源”，也不能看“conversation 创建方式”，只能看当前 composer 是否还持有 `skill-creator` chip。

否则用户删掉 chip 后，placeholder 仍残留技能创建提示，会让会话状态看起来错乱。

## 验收标准

- 用户从技能面板点击 `创建技能` 后，不再出现资源库弹框
- 当前工作区会创建并打开一个普通 conversation
- 首次打开时，composer 顶部可见 `skill-creator` chip
- 输入框显示技能创建引导 placeholder
- 用户删除 chip 后，placeholder 恢复默认文案
- 关闭再打开该 conversation 时，不自动恢复 `skill-creator` chip
- 最终技能创建成功后，结果仍写入现有 skills 目录

## 结论

本设计把“创建技能”从资源库创建器，收敛为“普通 conversation 的一次性 skill 起手注入”。

它保留了：

- 用户可见的 `skill-creator`
- 自然语言驱动的技能创建过程
- 现有 `skills service` 的最终落盘能力

它明确拒绝了：

- workflow tab
- 专用会话身份
- 中间过程落盘
- 资源库弹框主流程

这是当前需求下复杂度最低、产品语义最稳、实现成本最可控的方案。
