# 测试脚本目录

> 本目录包含NAC工程的各种测试脚本

---

## 脚本列表

### 自动化测试脚本

#### test-runner-auto.ts
**功能**: 自动化测试运行器
**用途**: 批量执行测试用例
**运行**: `pnpm tsx tests/scripts/test-runner-auto.ts`

#### test-runner.ts
**功能**: 手动测试运行器
**用途**: 交互式执行单个测试用例
**运行**: `pnpm tsx tests/scripts/test-runner.ts`

#### test-suite.ts
**功能**: 测试套件
**用途**: 组织和执行多个相关测试
**运行**: `pnpm tsx tests/scripts/test-suite.ts`

---

## 专项测试脚本

### test-api.ts
**功能**: API接口测试
**用途**: 测试REST API端点和功能
**运行**: `pnpm tsx tests/scripts/test-api.ts`

### test-sessionstore.ts
**功能**: 会话存储测试
**用途**: 测试会话管理功能
**运行**: `pnpm tsx tests/scripts/test-sessionstore.ts`

### test-search-intent.js
**功能**: 意图搜索测试
**用途**: 测试意图识别和解析功能
**运行**: `node tests/scripts/test-search-intent.js`

---

## 使用指南

### 运行所有测试脚本
```bash
# 从项目根目录运行
pnpm tsx tests/scripts/test-runner-auto.ts
```

### 运行单个脚本
```bash
# 运行API测试
pnpm tsx tests/scripts/test-api.ts

# 运行会话存储测试
pnpm tsx tests/scripts/test-sessionstore.ts
```

### 调试测试脚本
```bash
# 使用调试模式运行
pnpm tsx --inspect-brk tests/scripts/test-runner.ts
```

---

## 脚本开发规范

### 命名规范
- 测试运行器: `test-runner-*.ts`
- 功能测试: `test-[feature].ts`
- 集成测试: `test-[module]-integration.ts`

### 代码规范
- 使用TypeScript编写
- 遵循项目编码规范
- 包含完整的错误处理
- 提供清晰的控制台输出

### 文档要求
- 每个脚本必须包含功能说明
- 注释复杂逻辑
- 提供使用示例

---

## 常见问题

### Q: 如何添加新的测试脚本？
A:
1. 在本目录创建新的TypeScript文件
2. 按照命名规范命名文件
3. 实现测试逻辑
4. 更新本README的脚本列表

### Q: 测试脚本失败怎么办？
A:
1. 检查控制台输出的错误信息
2. 确认依赖项已正确安装
3. 验证环境配置是否正确
4. 查看相关文档和日志

### Q: 如何调试测试脚本？
A:
1. 使用 `--inspect-brk` 标志启动调试
2. 在VSCode中设置断点
3. 使用Chrome DevTools进行调试

---

*最后更新: 2026-03-08*
