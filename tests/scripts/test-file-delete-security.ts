/**
 * File Delete Security Test
 * Tests the file delete confirmation mechanism
 */

import { FileOpsSkill } from '../../src/skills/builtin/FileOpsSkill.js';
import assert from 'assert';

console.log('=== 🔒 文件删除安全机制测试 ===\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(testName: string, testFn: () => Promise<void>) {
  return testFn().then(() => {
    console.log(`✅ ${testName}`);
    testsPassed++;
  }).catch((error: any) => {
    console.log(`❌ ${testName}`);
    console.log(`   错误: ${error.message}`);
    testsFailed++;
  });
}

async function main() {
  console.log('## 测试1: 删除确认机制\n');

  await runTest('SEC-006: 删除操作需要用户确认', async () => {
    const result = await FileOpsSkill.execute(
      {},
      {
        operation: 'delete',
        path: 'skills/custom/test-file.txt'
      }
    );

    assert.strictEqual(result.success, false, '删除操作应该需要确认');
    assert.strictEqual(result.requiresConfirmation, true, '应该标记需要确认');
    assert.ok(result.warning, '应该提供警告信息');
    assert.ok(result.warning?.includes('⚠️'), '警告应该包含警告符号');
    assert.ok(result.warning?.includes('不可撤销'), '警告应该说明不可撤销');
  });

  await runTest('SEC-006: 确认后可以删除', async () => {
    // 创建一个测试文件
    const fs = await import('fs/promises');
    const testPath = 'skills/custom/test-delete-confirmation.txt';
    await fs.writeFile(testPath, 'test content');

    // 尝试删除(未确认)
    const result1 = await FileOpsSkill.execute(
      {},
      {
        operation: 'delete',
        path: testPath,
        confirmed: false
      }
    );

    assert.strictEqual(result1.success, false, '未确认时不应该删除');

    // 确认文件仍然存在
    const fs2 = await import('fs');
    assert.ok(fs2.existsSync(testPath), '文件应该仍然存在');

    // 确认后删除
    const result2 = await FileOpsSkill.execute(
      {},
      {
        operation: 'delete',
        path: testPath,
        confirmed: true
      }
    );

    assert.strictEqual(result2.success, true, '确认后应该成功删除');
    assert.strictEqual(result2.result?.deleted, true, '应该标记为已删除');

    // 确认文件已被删除
    assert.ok(!fs2.existsSync(testPath), '文件应该已被删除');
  });

  console.log('\n## 测试2: 批量删除保护\n');

  await runTest('SEC-007: 批量删除需要额外确认', async () => {
    const result = await FileOpsSkill.execute(
      {},
      {
        operation: 'delete',
        path: 'test-file.txt',
        confirmed: true,
        batch: true,
        batchConfirmed: false
      }
    );

    assert.strictEqual(result.success, false, '批量删除应该需要额外确认');
    assert.strictEqual(result.requiresConfirmation, true, '应该标记需要确认');
    assert.ok(result.warning?.includes('批量删除'), '警告应该提及批量删除');
  });

  await runTest('SEC-007: 批量删除确认后可以执行', async () => {
    const fs = await import('fs/promises');
    const testPath = 'skills/custom/test-batch-delete.txt';
    await fs.writeFile(testPath, 'test content');

    const result = await FileOpsSkill.execute(
      {},
      {
        operation: 'delete',
        path: testPath,
        confirmed: true,
        batch: true,
        batchConfirmed: true
      }
    );

    assert.strictEqual(result.success, true, '双重确认后批量删除应该成功');

    // 清理
    const fs2 = await import('fs');
    if (fs2.existsSync(testPath)) {
      await fs.unlink(testPath);
    }
  });

  console.log('\n## 测试3: 路径验证\n');

  await runTest('路径验证: 允许的路径', async () => {
    const result = await FileOpsSkill.execute(
      {},
      {
        operation: 'read',
        path: 'src/skills/builtin/FileOpsSkill.ts'
      }
    );

    assert.strictEqual(result.success, true, '应该允许访问允许范围内的路径');
  });

  await runTest('路径验证: 禁止的路径(node_modules)', async () => {
    const result = await FileOpsSkill.execute(
      {},
      {
        operation: 'read',
        path: 'node_modules/some-package/index.js'
      }
    );

    assert.strictEqual(result.success, false, '应该禁止访问node_modules');
    assert.ok(result.error?.includes('node_modules'), '错误信息应该提及node_modules');
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
    console.log('\n✅ 所有文件删除安全测试通过！');
    console.log('\n🔒 文件操作安全状态:');
    console.log('   ✅ 删除操作需要确认');
    console.log('   ✅ 批量删除有额外保护');
    console.log('   ✅ 路径白名单验证');
    console.log('   ✅ node_modules访问保护');
    console.log('\n🎯 用户需要明确确认危险操作，防止误删除！');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
