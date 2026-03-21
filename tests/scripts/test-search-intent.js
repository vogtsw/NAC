/**
 * Test search intent recognition and WebSearchSkill
 */

import { createOrchestrator } from './src/orchestrator/Orchestrator.js';

async function testSearchIntent() {
  console.log('=== Testing Search Intent Recognition ===\n');

  const orchestrator = createOrchestrator();
  await orchestrator.initialize();

  const sessionId = `test-search-${Date.now()}`;

  // Test 1: Search with "search" keyword
  console.log('Test 1: "search thenews about ai"');
  const result1 = await orchestrator.processRequest({
    sessionId,
    userInput: 'search thenews about ai',
    context: {},
  });

  console.log('Intent Type:', result1.data?.intentType || 'unknown');
  console.log('Capabilities:', result1.data?.capabilities || []);
  console.log('Response Preview:', result1.response?.substring(0, 100) + '...');
  console.log('Success:', result1.success ? '✅' : '❌');
  console.log('');

  // Test 2: Chinese search
  console.log('Test 2: "搜索人工智能新闻"');
  const result2 = await orchestrator.processRequest({
    sessionId,
    userInput: '搜索人工智能新闻',
    context: {},
  });

  console.log('Intent Type:', result2.data?.intentType || 'unknown');
  console.log('Capabilities:', result2.data?.capabilities || []);
  console.log('Response Preview:', result2.response?.substring(0, 100) + '...');
  console.log('Success:', result2.success ? '✅' : '❌');
  console.log('');

  // Test 3: Check if web-search skill is loaded
  console.log('Test 3: Check if web-search skill exists');
  const skillManager = orchestrator.getSkillManager?.();
  if (skillManager) {
    const webSearchSkill = skillManager.getSkill('web-search');
    console.log('web-search skill exists:', webSearchSkill ? '✅' : '❌');
    if (webSearchSkill) {
      console.log('web-search enabled:', webSearchSkill.enabled ? '✅' : '❌');
      console.log('web-search builtin:', webSearchSkill.builtin ? '✅' : '❌');
    }
  }

  await orchestrator.shutdown();
  console.log('\n=== Test Complete ===');
}

testSearchIntent().catch(console.error);
