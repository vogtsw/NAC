/**
 * Test 智谱 API (Zhipu AI)
 * Direct test of 智谱 API functionality
 */

import { LLMClient } from '../src/llm/LLMClient.js';

async function testZhipuAPI() {
  console.log('=== 测试智谱 API ===\n');

  const client = new LLMClient({
    apiKey: '92352829f8dc422aa9b1fad8b4d60bd4.IiyOhFSWbZsn6pWJ',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    model: 'glm-4-flash',
  });

  // Test 1: 简单对话
  console.log('测试 1: 简单对话');
  console.log('提示词: 你好，请介绍一下你自己');
  console.log('---');

  try {
    const response1 = await client.complete('你好，请介绍一下你自己', {
      temperature: 0.7,
      maxTokens: 500,
    });

    console.log('响应:', response1);
    console.log('✓ 测试 1 通过\n');
  } catch (error: any) {
    console.error('✗ 测试 1 失败:', error.message);
    console.error('错误详情:', error);
  }

  // Test 2: JSON 格式响应
  console.log('测试 2: JSON 格式响应');
  console.log('提示词: 返回 JSON 格式的用户信息');
  console.log('---');

  try {
    const response2 = await client.complete(
      '请返回一个 JSON 对象，包含以下字段：name（中文名）、age（年龄）、city（城市）。使用真实合理的中文值。',
      { responseFormat: 'json', maxTokens: 500 }
    );

    console.log('响应:', response2);

    const parsed = JSON.parse(response2);
    console.log('解析结果:', parsed);
    console.log('✓ 测试 2 通过\n');
  } catch (error: any) {
    console.error('✗ 测试 2 失败:', error.message);
  }

  // Test 3: 代码生成
  console.log('测试 3: 代码生成');
  console.log('提示词: 生成一个 TypeScript 函数');
  console.log('---');

  try {
    const response3 = await client.complete(
      '请生成一个 TypeScript 函数，实现两个数字相加的功能。要求包含类型注解和 JSDoc 注释。',
      { maxTokens: 800 }
    );

    console.log('响应:', response3);
    console.log('✓ 测试 3 通过\n');
  } catch (error: any) {
    console.error('✗ 测试 3 失败:', error.message);
  }

  // Test 4: 意图解析模拟
  console.log('测试 4: 意图解析');
  console.log('提示词: 解析用户意图');
  console.log('---');

  try {
    const response4 = await client.complete(
      `你是一个任务分析助手。请分析用户输入的意图，提取关键信息。

用户输入：创建一个用户登录的 RESTful API

请以JSON格式返回分析结果，包含以下字段：
1. intent_type: 意图类型（code, data, automation, analysis, deployment, other）
2. primary_goal: 主要目标描述
3. required_capabilities: 所需能力列表
4. complexity: 复杂度评估（simple, medium, complex）
5. estimated_steps: 预估执行步骤数`,
      { responseFormat: 'json', maxTokens: 1000 }
    );

    console.log('响应:', response4);

    const intent = JSON.parse(response4);
    console.log('解析的意图:', {
      type: intent.intent_type,
      primaryGoal: intent.primary_goal,
      capabilities: intent.required_capabilities,
      complexity: intent.complexity,
    });
    console.log('✓ 测试 4 通过\n');
  } catch (error: any) {
    console.error('✗ 测试 4 失败:', error.message);
  }

  // Test 5: 流式响应
  console.log('测试 5: 流式响应');
  console.log('提示词: 数数 1 到 5');
  console.log('---');

  try {
    console.log('流式输出: ');
    const chunks: string[] = [];

    for await (const chunk of client.streamComplete('请数数 1 到 5', { maxTokens: 100 })) {
      chunks.push(chunk);
      process.stdout.write(chunk);
    }

    console.log('\n\n总块数:', chunks.length);
    console.log('✓ 测试 5 通过\n');
  } catch (error: any) {
    console.error('✗ 测试 5 失败:', error.message);
  }

  // Test 6: 任务规划
  console.log('测试 6: 任务规划');
  console.log('提示词: 为任务制定执行计划');
  console.log('---');

  try {
    const response6 = await client.complete(
      `你是一个任务规划专家。用户想要：创建一个博客网站。

请制定详细的执行计划，返回JSON格式：
{
  "steps": [
    {
      "id": "step_1",
      "name": "步骤名称",
      "description": "详细描述",
      "agent_type": "所需Agent类型",
      "dependencies": [],
      "estimated_duration": 300
    }
  ],
  "parallelizable_groups": [[1, 2], [3, 4]],
  "critical_path": [1, 3, 5]
}`,
      { responseFormat: 'json', maxTokens: 2000 }
    );

    console.log('响应:', response6);

    const plan = JSON.parse(response6);
    console.log('执行计划:');
    console.log(`  步骤数: ${plan.steps?.length || 0}`);
    console.log(`  可并行组: ${plan.parallelizable_groups?.length || 0}`);
    console.log('✓ 测试 6 通过\n');
  } catch (error: any) {
    console.error('✗ 测试 6 失败:', error.message);
  }

  console.log('=== 所有测试完成 ===');
  await client.close();
}

// 运行测试
testZhipuAPI().catch((error) => {
  console.error('致命错误:', error);
  console.error('错误详情:', error);
  process.exit(1);
});
