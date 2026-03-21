# NAC 工程测试目录

> **测试是确保质量的关键**
>
> 本目录包含NAC工程的所有测试相关文件

---

## 目录结构

```
tests/
├── README.md           # 本文件 - 测试目录总览
├── cases/              # 测试用例文档
│   ├── README.md       # 测试用例索引
│   ├── test-cases-20.md           # 20个复杂测试用例
│   └── test-complex-cases.md      # 复杂测试用例集
├── scripts/            # 测试脚本
│   ├── test-runner.ts
│   ├── test-runner-auto.ts
│   ├── test-suite.ts
│   ├── test-api.ts
│   ├── test-sessionstore.ts
│   └── test-search-intent.js
├── reports/            # 测试报告
│   ├── test-report.md
│   └── test-report-20cases.md
├── unit/               # 单元测试
├── integration/        # 集成测试
├── e2e/                # 端到端测试
├── fixtures/           # 测试数据
├── basic.test.ts       # 基础测试
├── core-validation.test.ts  # 核心验证测试
├── integration.test.ts # 集成测试
├── run-core-tests.ts   # 核心测试运行器
├── vitest.config.ts    # Vitest配置文件
├── conftest.py         # Python测试配置
└── __init__.py         # Python测试初始化
```

---

## 快速开始

### 运行单元测试
```bash
pnpm test
```

### 运行集成测试
```bash
pnpm test:integration
```

### 运行核心验证测试
```bash
pnpm test:core
```

### 运行交互式聊天测试
```bash
pnpm cli chat
```
然后从 `tests/cases/` 中选择测试用例执行。

---

## 测试分类

### 1. 自动化测试
- **单元测试**: 测试单个函数、类或组件
- **集成测试**: 测试模块间的交互
- **端到端测试**: 测试完整的用户场景

### 2. 手动测试
- **聊天测试**: 通过 `pnpm cli chat` 进行真实用户场景测试
- **测试用例**: 位于 `tests/cases/` 目录

---

## 测试文档

### 测试方法论
详见项目根目录的 `test.md`

### 测试用例
详见 `tests/cases/README.md`

### 测试报告
详见 `tests/reports/` 目录

---

## 测试覆盖率

当前测试覆盖：
- ✅ 核心Agent功能
- ✅ DAG构建和调度
- ✅ Skill调用机制
- ✅ 意图解析
- ✅ 多Agent协作
- ✅ 会话管理
- ⏳ API服务（待完善）
- ⏳ 定时任务（待完善）

---

## 贡献指南

### 添加新测试用例
1. 在 `tests/cases/` 中创建新的测试用例文件
2. 更新 `tests/cases/README.md` 索引
3. 执行测试并记录结果到 `tests/reports/`

### 添加新测试脚本
1. 在 `tests/scripts/` 中创建新的测试脚本
2. 确保脚本遵循现有命名规范
3. 更新本README的脚本列表

### 报告测试问题
1. 在 `tests/reports/` 中创建详细的测试报告
2. 包含问题描述、重现步骤、预期行为
3. 提供改进建议

---

## 相关文档

- [测试方法论](../test.md) - 完整的测试方法论
- [项目任务](../task.md) - 工程总任务要求
- [项目规范](../CLAUDE.md) - 开发规范和指南

---

*最后更新: 2026-03-08*
