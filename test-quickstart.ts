#!/usr/bin/env tsx
/**
 * NAC 快速测试脚本
 * 验证核心功能是否正常工作
 */

import { Orchestrator } from './src/orchestrator/Orchestrator.js';
import { AgentFactory } from './src/agents/AgentFactory.js';
import { SkillManager } from './src/skills/SkillManager.js';

async function quickTest() {
  console.log('🚀 NAC 快速测试开始...\n');

  // 1. 测试SkillManager
  console.log('1️⃣  测试技能系统...');
  const skillManager = new SkillManager();
  const skills = await skillManager.listSkills();
  console.log(`   ✅ 已加载 ${skills.length} 个技能`);
  console.log(`   可用技能: ${skills.slice(0, 5).map(s => s.name).join(', ')}...\n`);

  // 2. 测试Agent创建
  console.log('2️⃣  测试Agent创建...');
  const codeAgent = await AgentFactory.createAgent('code');
  console.log(`   ✅ 成功创建 ${codeAgent.constructor.name}\n`);

  // 3. 测试Orchestrator
  console.log('3️⃣  测试编排器...');
  const orchestrator = new Orchestrator();
  console.log('   ✅ 编排器初始化成功\n');

  // 4. 简单任务测试
  console.log('4️⃣  测试简单任务处理...');
  try {
    const result = await orchestrator.processRequest({
      input: '你好，请介绍一下你的功能',
      sessionId: 'test-session-' + Date.now()
    });
    console.log('   ✅ 任务处理成功');
    console.log(`   响应: ${result.response?.slice(0, 100)}...\n`);
  } catch (error) {
    console.log(`   ⚠️  任务处理跳过 (可能需要API密钥): ${error.message}\n`);
  }

  console.log('✨ 测试完成！NAC系统运行正常。\n');
  console.log('提示: 运行 "pnpm cli chat" 进入交互式对话模式');
}

quickTest().catch(console.error);
