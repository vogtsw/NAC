# NexusAgent-Cluster

通用多智能体任务编排系统

## 项目概述

NexusAgent-Cluster (NAC) 是一个通用的、可扩展的多智能体任务编排系统。系统根据用户输入的任务意图，自动生成、调度和管理多个专业化的子智能体，通过并行协作完成复杂任务。

### 核心特性

- **Intent-to-Action**：将自然语言意图转化为可执行的任务序列
- **动态代理生成**：根据任务需求动态生成具有特定角色的子智能体
- **Skills 系统**：可扩展的技能和能力管理
- **启发式并行编排**：基于 DAG 调度算法，自动识别可并行任务
- **全能力覆盖**：支持终端、文件、浏览器、计算机交互等多种操作能力

### 支持的任务类型

- 代码开发
- 数据分析
- 自动化运维
- 浏览器自动化
- 文件处理
- 系统管理

## 快速开始

### 环境要求

- Python >= 3.11
- Docker & Docker Compose
- Redis
- PostgreSQL

### 安装

```bash
# 使用 uv 安装依赖
uv sync

# 或使用 pip
pip install -e .
```

### 配置

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入你的 API Keys
```

### 运行

```bash
# 启动开发环境
docker-compose -f docker/docker-compose.yml up -d

# 运行 CLI
python -m nexus "分析当前目录的文件"

# 启动 API 服务
uvicorn nexus.api.main:app --reload
```

## 项目结构

```
nexus-agent-cluster/
├── nexus/                # 源代码
│   ├── orchestrator/     # 核心编排者
│   ├── agents/           # 子代理系统
│   ├── skills/           # Skills 系统
│   ├── tools/            # MCP 工具集成
│   ├── sandbox/          # 沙箱管理
│   ├── state/            # 共享状态管理
│   ├── api/              # API 层
│   └── monitoring/       # 监控
├── skills/               # Skills 定义
├── tests/                # 测试
└── docker/               # Docker 配置
```

## 开发

```bash
# 运行测试
pytest

# 代码格式化
ruff format nexus/
ruff check nexus/

# 类型检查
mypy nexus/
```

## 许可证

MIT License
