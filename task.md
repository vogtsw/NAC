要让 `jiqun` 作为 agent 工具真正变强，优先级不是“再加更多 agent”，而是把底层 agent runtime 做硬。按现在代码看，最该先做这 5 件事：

**1. 先修 Tool Protocol，这是 P0**

现在 [loop.ts](</d:/test/mygithub/jiqun/src/agent/loop.ts:1>) 里把 assistant tool calls 存成 JSON 字符串，再临时还原成 OpenAI 格式。这很脆，benchmark 里 DeepSeek 的 `tool_calls` 错误基本就来自这里。

要做的是新增一个统一转录层，比如：

`src/agent/transcript.ts`

它负责：

- assistant 带 `tool_calls` 时，后面必须紧跟对应 `tool` message
- 裁剪历史时，不能把 assistant tool call 和 tool result 拆开
- 压缩历史时，tool call/result 要成对摘要
- 不再把 tool call 塞进 `content: JSON.stringify(...)`
- OpenAI / DeepSeek / 自定义 provider 都走同一个 `toChatMessages()` 输出

这一步最能直接提高 benchmark 分数。目标是先修掉那几个 0 tool calls / DeepSeek 协议错误。

**2. 把工具系统从“能跑”升级成“可验证、可授权、可审计”**

现在 [base.ts](</d:/test/mygithub/jiqun/src/tools/base.ts:1>) 有参数描述，但执行前没有强 schema validation；[executor.ts](</d:/test/mygithub/jiqun/src/tools/executor.ts:1>) 主要做并行/串行和 timeout。

建议改成：

- 每个 Tool 带 `zod schema`
- 执行前统一 validate args
- Tool metadata 标明 `read/write/network/shell/destructive`
- executor 先生成 `ToolExecutionPlan`
- 读操作可并行，写操作按路径加锁串行
- 权限判断返回结构化结果：`allow | deny | ask`
- 所有工具执行写入 trajectory，方便复盘和训练

这样才接近 Claude Code / Hermes 那种严谨工具管线。

**3. 重做 Context / Memory，不要只按消息数量截断**

[context.ts](</d:/test/mygithub/jiqun/src/agent/context.ts:1>) 现在是简单拼 system prompt、history、user request。问题是 agent 变长任务后会丢关键状态。

需要加一个 `ContextManager`：

- token budget，而不是固定 `MAX_HISTORY = 10`
- 保留任务目标、用户约束、已读文件、已修改文件、失败工具、待办事项
- 把历史压缩成结构化 state，不只是自然语言 summary
- 从 `session-db` 取回相关历史，而不是全塞进去
- 修掉当前 loop 里“history 里已有 userRequest，又在 build() 末尾再加一次 userRequest”的重复注入问题

这会明显提升长任务稳定性。

**4. 把 loop 改成状态机，而不是 while 里一大段逻辑**

现在 [loop.ts](</d:/test/mygithub/jiqun/src/agent/loop.ts:1>) 什么都在一个循环里：压缩、构造消息、调用模型、工具执行、loop 检测、错误恢复。

建议拆成：

- `prepareTurn()`
- `callModel()`
- `normalizeToolCalls()`
- `executeTools()`
- `observeResults()`
- `maybeReflect()`
- `decideStop()`

同时把错误分级：

- provider 协议错误
- context 超限
- tool schema 错误
- tool permission 错误
- repeated tool loop
- task validation failed

现在 `tool_loop_detected` 是硬停，应该先注入“换策略”反思一次，第二次还循环才停。这会让 agent 看起来更像成熟工具，而不是一撞墙就退出。

**5. 保留 Jiqun 的强项：DAG 多 agent，但给每个 DAG task 加 contract**

`jiqun` 真正有差异化的是 [DAGBuilderV2.ts](</d:/test/mygithub/jiqun/src/orchestrator/DAGBuilderV2.ts:1>)、[AgentRouter.ts](</d:/test/mygithub/jiqun/src/orchestrator/AgentRouter.ts:1>)、[TaskExecutor.ts](</d:/test/mygithub/jiqun/src/orchestrator/TaskExecutor.ts:1>) 这一层。

但每个 task 现在还应该更工程化：

```ts
interface TaskContract {
  objective: string;
  inputs: string[];
  expectedArtifacts: string[];
  acceptanceCriteria: string[];
  allowedTools: string[];
  maxIterations: number;
}
```

每个子 agent 不只是返回文本，而是返回：

```ts
interface TaskResult {
  status: "success" | "partial" | "failed";
  summary: string;
  artifacts: string[];
  evidence: string[];
  nextActions: string[];
}
```

这样 DAG scheduler 才能真正判断哪个节点完成、哪个节点要 retry、哪个节点要重规划。

**推荐实现顺序**

1. `src/agent/transcript.ts`：统一消息协议，修 DeepSeek/OpenAI tool_calls 兼容。
2. 改 [loop.ts](</d:/test/mygithub/jiqun/src/agent/loop.ts:1>)：移除 JSON 字符串伪 tool call，改用 typed transcript。
3. 改 [base.ts](</d:/test/mygithub/jiqun/src/tools/base.ts:1>) 和 [executor.ts](</d:/test/mygithub/jiqun/src/tools/executor.ts:1>)：加入 schema validation、权限、路径锁。
4. 新增 `src/agent/context-manager.ts`：token budget + structured compression。
5. 改 [TaskExecutor.ts](</d:/test/mygithub/jiqun/src/orchestrator/TaskExecutor.ts:1>)：让 DAG task 走 TaskContract / TaskResult。
6. 把 benchmark 失败案例固化成回归测试，目标先把 83.3% 拉到 90%+。

最小有效版本就是先做第 1、2 步。它们不炫，但最直接决定 agent 是否稳定。等 tool protocol 和 loop 稳了，再扩 DAG、多 agent、memory 才有意义。

我对 Agent 的理解不是只看一次回答质量，而是看它能否在可验证环境里持续变强。Orbit Wars 里我把每轮失败转成 failure taxonomy、trace、opponent pool、fixed-seed regression 和版本日志。这个过程很像 Heuristic Learning：更新对象不是神经网络权重，而是可读、可回归、可压缩的软件系统。这也对应模型产品工作里“场景痛点 → 能力 gap → 数据/评测标准 → 迭代闭环”的方法。