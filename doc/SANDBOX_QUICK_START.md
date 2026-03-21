# 🛡️ NAC 沙箱隔离系统 - 快速开始指南

> **功能**: 提供企业级的多层沙箱隔离，保护系统安全
> **状态**: ✅ 已完成并测试通过 (25/25测试)
> **GitHub提交**: cc3924a

---

## 📋 快速开始

### 1. 基本使用

#### 在代码中使用沙箱
```typescript
import { getSandboxManager } from './security/SandboxManager.js';

const sandbox = getSandboxManager();

// 检查命令是否允许
const result = sandbox.isCommandAllowed('ls -la');
if (result.allowed) {
  console.log('命令允许执行');
} else {
  console.error('命令被禁止:', result.reason);
}

// 检查路径访问
const pathResult = sandbox.isPathAllowed('/app/src', 'write');

// 检查网络访问
const netResult = sandbox.isNetworkAllowed('https://api.example.com');
```

### 2. Docker部署

#### 构建和启动
```bash
# 构建镜像
docker-compose build

# 启动容器
docker-compose up -d

# 查看日志
docker-compose logs -f nac

# 停止容器
docker-compose down
```

### 3. 配置沙箱级别

#### 环境变量配置
```bash
# STRICT (最严格 - 生产环境推荐)
export NAC_SANDBOX_LEVEL=strict

# MODERATE (适度 - 开发环境)
export NAC_SANDBOX_LEVEL=moderate

# PERMISSIVE (宽松 - 调试环境)
export NAC_SANDBOX_LEVEL=permissive
```

---

## 🔐 安全特性

### 命令沙箱
```typescript
// ✅ 允许的安全命令 (25+个)
ls, cat, grep, find, node, tsx, tsc, sed, awk...

// ❌ 禁止的危险命令 (20+个)
rm, rmdir, sudo, curl, wget, ssh, kill...

// ⚠️ 需要批准的命令
git, npm, pnpm...
```

### 文件系统沙箱
```typescript
// ✅ 允许访问的目录
- 项目目录 (读写)
- /tmp (读写)
- 用户主目录 (只读)

// ❌ 禁止访问的目录
- /etc (系统配置)
- /root (管理员目录)
- 其他系统目录
```

### 网络沙箱
```typescript
// ✅ 允许
- https://api.example.com (HTTPS)

// ❌ 禁止
- http://example.com (HTTP不安全)
- ftp://example.com (FTP协议)
- 其他未知协议
```

### 资源限制
```typescript
{
  maxExecutionTime: 30000,  // 30秒
  maxMemory: 512,           // 512 MB
  maxCpuUsage: 80,          // 80%
  maxFileSize: 10,          // 10 MB
  maxProcesses: 10          // 10个进程
}
```

---

## 🧪 测试验证

### 运行测试
```bash
# 运行沙箱测试套件
npx tsx tests/scripts/test-sandbox.ts

# 测试结果
✅ 通过: 25个
❌ 失败: 0个
📈 通过率: 100%
```

### 测试覆盖
- 命令白名单: 8个测试
- 路径白名单: 6个测试
- 网络控制: 3个测试
- 审计日志: 3个测试
- 资源限制: 1个测试
- 配置: 2个测试
- 真实场景: 2个测试

---

## 📊 审计日志

### 查看统计
```typescript
const stats = sandbox.getStats();
console.log(stats);
// {
//   totalOperations: 100,
//   allowedOperations: 85,
//   blockedOperations: 15,
//   byCategory: { command: 50, path: 30, network: 20 },
//   recentBlocked: [...]
// }
```

### 导出日志
```typescript
// 导出审计日志到文件
await sandbox.exportAuditLog('./logs/audit.json');
```

---

## 🎯 使用场景

### 场景1: 安全的文件操作
```typescript
// ✅ 安全: 使用沙箱保护的终端
import { TerminalSkill } from './skills/builtin/TerminalSkill.js';

// 自动检查命令是否允许
const result = await TerminalSkill.execute({}, {
  command: 'ls -la',
  cwd: '/app/src'
});
```

### 场景2: Docker容器化部署
```yaml
# docker-compose.yml
services:
  nac:
    image: nexus-agent-cluster:latest
    # 资源限制
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
    # 安全选项
    security_opt:
      - no-new-privileges:true
    # 只读根文件系统
    read_only: true
```

### 场景3: 开发环境配置
```typescript
// 开发环境使用适度的沙箱级别
import { createSandboxManager, SandboxLevel } from './security/SandboxManager.js';

const devSandbox = createSandboxManager({
  level: SandboxLevel.MODERATE,
  enableAudit: true,
  enableLogging: true
});
```

---

## ⚠️ 安全最佳实践

### 1. 生产环境
- ✅ 使用 `STRICT` 沙箱级别
- ✅ 启用审计日志
- ✅ 使用Docker容器化
- ✅ 定期导出审计日志
- ✅ 监控阻塞的操作

### 2. 开发环境
- ✅ 使用 `MODERATE` 沙箱级别
- ✅ 启用审计日志
- ✅ 允许git、npm等受限命令
- ✅ 测试时使用 `bypassSandbox: true`

### 3. 调试环境
- ✅ 使用 `PERMISSIVE` 沙箱级别
- ✅ 可以绕过沙箱: `bypassSandbox: true`
- ⚠️ 仅用于调试，不要在生产使用

---

## 🚨 常见问题

### Q1: 如何允许被禁止的命令？
**A**: 不建议绕过沙箱。如果必须：
```typescript
// 方法1: 使用bypassSandbox（不推荐）
await TerminalSkill.execute({}, {
  command: 'rm file.txt',
  bypassSandbox: true  // ⚠️ 危险！
});

// 方法2: 使用FileOpsSkill代替（推荐）
import { FileOpsSkill } from './skills/builtin/FileOpsSkill.js';
await FileOpsSkill.execute({}, {
  operation: 'delete',
  path: 'file.txt',
  confirmed: true
});
```

### Q2: 如何添加新的安全命令？
**A**: 修改沙箱配置：
```typescript
import { createSandboxManager, CommandCategory } from './security/SandboxManager.js';

const customSandbox = createSandboxManager({
  commandWhitelist: [
    ...DEFAULT_SAFE_COMMANDS,
    {
      command: 'mycommand',
      category: CommandCategory.SAFE,
      allowed: true,
      requiresApproval: false,
      description: 'My custom command'
    }
  ]
});
```

### Q3: 如何查看被阻止的操作？
**A**: 查看审计日志：
```typescript
const stats = sandbox.getStats();
console.log('最近被阻止的操作:', stats.recentBlocked);

// 导出完整日志
await sandbox.exportAuditLog('./audit.json');
```

---

## 📚 更多信息

### 文档
- `SANDBOX_IMPLEMENTATION_REPORT.md` - 完整实施报告
- `src/security/SandboxManager.ts` - 源代码
- `tests/scripts/test-sandbox.ts` - 测试用例

### 相关功能
- **敏感数据过滤器** (P0) - 防止API密钥泄露
- **文件删除确认** (P0) - 防止误删除
- **沙箱隔离系统** (P1) - 多层安全防护

---

## ✅ 检查清单

使用沙箱系统前：
- [ ] 理解沙箱级别和限制
- [ ] 配置正确的路径白名单
- [ ] 测试所有要执行的命令
- [ ] 启用审计日志
- [ ] 配置资源限制

Docker部署前：
- [ ] 检查Dockerfile配置
- [ ] 验证docker-compose.yml设置
- [ ] 测试容器启动
- [ ] 确认资源限制
- [ ] 检查日志配置

---

*版本: 1.0.0*
*更新日期: 2026-03-12*
*状态: ✅ 生产就绪*
