/**
 * Test DeepSeek API
 * Direct test of DeepSeek API functionality
 */

import { LLMClient } from '../src/llm/LLMClient.js';

async function testDeepSeek() {
  console.log('=== Testing DeepSeek API ===\n');

  const client = new LLMClient({
    apiKey: 'sk-b2233a9bb3da43e3b7a56a210220e6cc',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  });

  // Test 1: Simple completion
  console.log('Test 1: Simple completion');
  console.log('Prompt: Say "Hello, World!" in Chinese');
  console.log('---');

  try {
    const response1 = await client.complete('Say "Hello, World!" in Chinese', {
      temperature: 0.3,
      maxTokens: 100,
    });

    console.log('Response:', response1);
    console.log('✓ Test 1 passed\n');
  } catch (error: any) {
    console.error('✗ Test 1 failed:', error.message);
  }

  // Test 2: JSON format
  console.log('Test 2: JSON format');
  console.log('Prompt: Return JSON with name, age, city');
  console.log('---');

  try {
    const response2 = await client.complete(
      'Return a JSON object with keys: name (Chinese), age, city (Chinese). Use realistic Chinese values.',
      { responseFormat: 'json', maxTokens: 500 }
    );

    console.log('Response:', response2);

    const parsed = JSON.parse(response2);
    console.log('Parsed:', parsed);
    console.log('✓ Test 2 passed\n');
  } catch (error: any) {
    console.error('✗ Test 2 failed:', error.message);
  }

  // Test 3: Code generation
  console.log('Test 3: Code generation');
  console.log('Prompt: Generate a TypeScript function to add two numbers');
  console.log('---');

  try {
    const response3 = await client.complete(
      'Generate a TypeScript function that adds two numbers and returns the result. Include type annotations.',
      { maxTokens: 500 }
    );

    console.log('Response:', response3);
    console.log('✓ Test 3 passed\n');
  } catch (error: any) {
    console.error('✗ Test 3 failed:', error.message);
  }

  // Test 4: Intent parsing simulation
  console.log('Test 4: Intent parsing');
  console.log('Prompt: Parse intent for "创建一个用户登录的API"');
  console.log('---');

  try {
    const response4 = await client.complete(
      `你是一个任务分析助手。请分析用户输入的意图，提取关键信息。

用户输入：创建一个用户登录的API

请以JSON格式返回分析结果，包含以下字段：
1. intent_type: 意图类型（code, data, automation, analysis, deployment, other）
2. primary_goal: 主要目标描述
3. required_capabilities: 所需能力列表
4. complexity: 复杂度评估（simple, medium, complex）
5. estimated_steps: 预估执行步骤数`,
      { responseFormat: 'json', maxTokens: 1000 }
    );

    console.log('Response:', response4);

    const intent = JSON.parse(response4);
    console.log('Parsed Intent:', {
      type: intent.intent_type,
      primaryGoal: intent.primary_goal,
      capabilities: intent.required_capabilities,
      complexity: intent.complexity,
    });
    console.log('✓ Test 4 passed\n');
  } catch (error: any) {
    console.error('✗ Test 4 failed:', error.message);
  }

  // Test 5: Streaming
  console.log('Test 5: Streaming completion');
  console.log('Prompt: Count from 1 to 5');
  console.log('---');

  try {
    const chunks: string[] = [];

    for await (const chunk of client.streamComplete('Count from 1 to 5', { maxTokens: 100 })) {
      chunks.push(chunk);
      process.stdout.write(chunk);
    }

    console.log('\n\nTotal chunks:', chunks.length);
    console.log('✓ Test 5 passed\n');
  } catch (error: any) {
    console.error('✗ Test 5 failed:', error.message);
  }

  console.log('=== All Tests Completed ===');
  await client.close();
}

// Run the test
testDeepSeek().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
