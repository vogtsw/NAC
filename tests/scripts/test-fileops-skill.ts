/**
 * 测试FileOpsSkill是否正常工作
 */

import { getSkillManager } from '../../src/skills/SkillManager.js';

async function testFileOpsSkill() {
  console.log('🧪 测试 FileOpsSkill...\n');

  const skillManager = getSkillManager();
  await skillManager.initialize();

  // 获取FileOpsSkill
  const fileOpsSkill = skillManager.getSkill('file-ops');

  console.log('✅ FileOpsSkill 信息:');
  console.log(`  名称: ${fileOpsSkill.name}`);
  console.log(`  版本: ${fileOpsSkill.version}`);
  console.log(`  类别: ${fileOpsSkill.category}`);
  console.log(`  描述: ${fileOpsSkill.description}`);
  console.log(`  启用: ${fileOpsSkill.enabled}`);
  console.log(`  内置: ${fileOpsSkill.builtin}`);

  // 测试读取操作
  console.log('\n📖 测试读取操作...');
  const readResult = await fileOpsSkill.execute(
    { logger: console },
    {
      operation: 'read',
      path: 'tests/cases/README.md',
    }
  );

  if (readResult.success) {
    console.log('✅ 读取成功!');
    console.log(`  文件大小: ${readResult.result.size} 字节`);
    console.log(`  内容预览: ${readResult.result.content.substring(0, 100)}...`);
  } else {
    console.log('❌ 读取失败:', readResult.error);
  }

  // 测试列出操作
  console.log('\n📂 测试列出目录操作...');
  const listResult = await fileOpsSkill.execute(
    { logger: console },
    {
      operation: 'list',
      path: 'tests/cases',
    }
  );

  if (listResult.success) {
    console.log('✅ 列出成功!');
    console.log(`  文件数量: ${listResult.result.count}`);
    console.log(`  文件列表: ${listResult.result.items.map((i: any) => i.name).join(', ')}`);
  } else {
    console.log('❌ 列出失败:', listResult.error);
  }

  // 测试路径验证
  console.log('\n🔒 测试路径安全验证...');

  // 测试1: 允许的路径
  const allowedPathResult = await fileOpsSkill.execute(
    { logger: console },
    {
      operation: 'exists',
      path: 'tests/cases/README.md',
    }
  );
  console.log(`  允许的路径测试: ${allowedPathResult.success ? '✅ 通过' : '❌ 失败'}`);

  // 测试2: 不允许的路径 (node_modules)
  const blockedPathResult = await fileOpsSkill.execute(
    { logger: console },
    {
      operation: 'read',
      path: 'node_modules/some-file.txt',
    }
  );
  console.log(`  阻止的路径测试: ${!blockedPathResult.success ? '✅ 正确阻止' : '❌ 未阻止'}`);
  if (!blockedPathResult.success) {
    console.log(`    错误信息: ${blockedPathResult.error}`);
  }

  console.log('\n✨ FileOpsSkill 测试完成!');
}

testFileOpsSkill().catch(console.error);
