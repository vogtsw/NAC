# 乱码问题修复指南

## 问题分析

Windows 命令行传递中文参数时存在编码问题，导致：
1. 输入的中文变成乱码：`*(7{U API`
2. LLM 返回的 JSON 中中文被 Unicode 转义：`\u4f60\u597d`

## 已修复的位置

1. **CLI (src/cli.ts)** - 添加 `fixEncoding()` 函数
2. **Orchestrator (src/orchestrator/Orchestrator.ts)** - 添加编码修复
3. **Scheduler (src/orchestrator/Scheduler.ts)** - 添加 Unicode 解码显示
4. **DAGBuilder (src/orchestrator/DAGBuilder.ts)** - 添加 Unicode 转义解码

## 推荐使用方式

### ✅ 方式 1: 使用文件输入（最推荐）

```bash
# 1. 创建任务文件（使用 UTF-8 编码）
echo 生成一个用户登录 API > task.txt

# 2. 运行
pnpm cli run --file task.txt
```

### ✅ 方式 2: 使用交互式模式

```bash
pnpm cli run --interactive

# 然后输入你的任务
```

### ✅ 方式 3: 使用 PowerShell（可能需要设置编码）

```powershell
# PowerShell 7+
$OutputEncoding = [console]::InputEncoding = [console]::OutputEncoding = [System.Text.Encoding]::UTF8
pnpm cli run "生成一个用户登录 API"
```

### ✅ 方式 4: 使用 Git Bash

```bash
# Git Bash 通常对 UTF-8 支持良好
pnpm cli run "生成一个用户登录 API"
```

### ⚠️ 不推荐：直接在 CMD 中使用中文

```bash
# 这样可能会有乱码
pnpm cli run "生成一个用户登录 API"
```

## 快速验证

### 方法 1: 测试文件模式

```bash
# 我已经创建了 test-task-utf8.txt 文件
pnpm cli run --file test-task-utf8.txt
```

### 方法 2: 创建新的测试文件

```bash
# 使用 PowerShell 创建 UTF-8 文件
powershell -Command "[System.IO.File]::WriteAllText('test-task.txt', '生成一个用户登录 API', [System.Text.Encoding]::UTF8)"

# 运行
pnpm cli run --file test-task.txt
```

### 方法 3: 使用英文测试（验证系统功能）

```bash
pnpm cli run "generate a user authentication API"
```

## 检查修复是否生效

运行后查看日志，应该看到：

```
[INFO] Processing request
    userInput: "生成一个用户登录 API"  # 正常中文，不是乱码

[INFO] Starting task
    taskName: "需求分析"  # 正常中文，不是 \u4e0b\u6c42
```

如果仍然看到乱码，请使用 `--file` 模式。

## 技术细节

### 编码问题根源

1. **Windows CMD** 默认使用 CP936/GBK 编码
2. **Node.js** 接收参数时可能解析错误
3. **LLM 返回 JSON** 时中文被 Unicode 转义

### 修复方法

```typescript
// 1. 移除控制字符
text.replace(/[\u0000-\u001F\uFFFd\ufffd]/g, '')

// 2. Latin1 → UTF8 转换
Buffer.from(text, 'latin1').toString('utf8')

// 3. Unicode 转义解码
text.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) =>
  String.fromCharCode(parseInt(h, 16))
)
```

## API 服务器模式（无编码问题）

如果 CLI 模式仍有问题，可以使用 API 服务器：

```bash
# 启动服务器
pnpm dev

# 发送请求（JSON 自动处理 UTF-8）
curl -X POST http://localhost:3000/api/v1/tasks/submit \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{"userInput": "生成一个用户登录 API"}' \
  --silent
```
