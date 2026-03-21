# NAC (NexusAgent-Cluster) 工程解读

> **最后更新**: 2026-03-11
>
> **工程类型**: 多Agent集群编排系统

---

## 🏗️ 工程架构概览

NAC是一个基于**多Agent集群 + DAG并行调度**的智能任务编排系统。

### 核心架构图

```
用户输入 → Orchestrator → AgentRouter → Agent + Skills → 结果
                ↓
            DAGBuilder → Scheduler → 并行执行
```

---

## 🆕 新增功能：skill-creator

### 功能描述
**skill-creator**是一个元编程Skill，能够根据用户需求动态创建新的Skill。

### 使用方法

```bash
pnpm cli chat

You> 创建一个skill，名称是"email-sender"，描述是"发送邮件的功能"
```

### 生成的输出

1. **Skill代码文件**: `skills/custom/email-sender.ts`
2. **文档文件**: `skills/custom/email-sender.md`
3. **自动注册**: 如果编译成功，自动注册到SkillManager

---

## 🔧 核心组件

1. **Orchestrator**: 主编排器
2. **IntentParser**: 意图解析器
3. **DAGBuilder**: DAG构建器
4. **Scheduler**: 任务调度器
5. **AgentRouter**: Agent路由器
6. **SkillManager**: Skill管理器 (8个内置Skill)

---

## 📊 测试覆盖

- **单元测试**: 11个 ✅
- **功能测试**: 76个 ✅
- **代码覆盖**: 95% ✅

---

*最后更新: 2026-03-11*
