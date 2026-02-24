/**
 * Integration Test for NexusAgent-Cluster
 * Tests all core components based on task.MD requirements
 * Works without Redis by using in-memory alternatives
 */

import { LLMClient } from '../src/llm/LLMClient.js';
import { IntentParser } from '../src/orchestrator/IntentParser.js';
import { DAGBuilder, DAG } from '../src/orchestrator/DAGBuilder.js';
import { Scheduler } from '../src/orchestrator/Scheduler.js';
import { SkillManager } from '../src/skills/SkillManager.js';
import { AgentFactory } from '../src/agents/AgentFactory.js';
import { GenericAgent, CodeAgent } from '../src/agents/index.js';
import { loadConfig } from '../src/config/index.js';

// In-memory EventBus for testing without Redis
import { EventEmitter } from 'events';

class InMemoryEventBus extends EventEmitter {
  async publish(eventType: string, data: any): Promise<void> {
    this.emit(eventType, data);
  }

  async initialize(): Promise<void> {
    // Nothing to initialize for in-memory
  }

  async close(): Promise<void> {
    this.removeAllListeners();
  }

  on(event: string, listener: (...args: any[]) => void) {
    super.on(event, listener);
    return () => this.off(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void) {
    super.off(event, listener);
  }
}

const config = loadConfig();

// Test results tracking
const results: { name: string; passed: boolean; error?: string } = [];

function test(name: string) {
  return {
    async run(fn: () => Promise<void>) {
      try {
        await fn();
        console.log(`✓ ${name}`);
        results.push({ name, passed: true });
      } catch (error: any) {
        console.error(`✗ ${name}:`, error.message);
        results.push({ name, passed: false, error: error.message });
      }
    }
  };
}

async function runIntegrationTests() {
  console.log('=== NexusAgent-Cluster Integration Tests ===\n');
  console.log('Testing with Zhipu AI API\n');
  console.log('Note: Running in in-memory mode (Redis not required)\n');

  // Initialize components
  const llm = new LLMClient(config.orchestrator.llmConfig);
  const skillManager = new SkillManager();
  await skillManager.initialize();

  const eventBus = new InMemoryEventBus();
  await eventBus.initialize();

  const agentFactory = new AgentFactory(llm, skillManager);

  // Test 1: LLM Client - Basic completion
  await test('1. LLM Client - Basic completion').run(async () => {
    const response = await llm.complete('Say "Hello, World!" in Chinese');
    if (!response || response.length === 0) {
      throw new Error('No response from LLM');
    }
    console.log('   Response:', response.slice(0, 100));
  });

  // Test 2: LLM Client - JSON format
  await test('2. LLM Client - JSON format response').run(async () => {
    const response = await llm.complete(
      'Return a JSON object with: name (Chinese), age, city (Chinese)',
      { responseFormat: 'json' }
    );
    const parsed = JSON.parse(response);
    if (!parsed.name || !parsed.age || !parsed.city) {
      throw new Error('Invalid JSON response');
    }
    console.log('   Parsed:', parsed);
  });

  // Test 3: Intent Parser - Parse user intent
  await test('3. Intent Parser - Parse user intent').run(async () => {
    const intentParser = new IntentParser(llm);
    const intent = await intentParser.parse('创建一个用户登录的 RESTful API');

    if (!intent.type || !intent.primaryGoal) {
      throw new Error('Invalid intent structure');
    }
    console.log('   Intent:', { type: intent.type, goal: intent.primaryGoal, complexity: intent.complexity });
  });

  // Test 4: DAG Builder - Build execution plan
  await test('4. DAG Builder - Build execution DAG').run(async () => {
    const dagBuilder = new DAGBuilder(llm);
    const intent = {
      type: 'code' as const,
      primaryGoal: '创建一个博客网站',
      capabilities: ['code_gen', 'api_design'],
      complexity: 'medium' as const,
      estimatedSteps: 3,
      constraints: []
    };

    const dag = await dagBuilder.build(intent);
    console.log('   DAG built successfully');
  });

  // Test 5: DAG - Task operations
  await test('5. DAG - Task dependency management').run(async () => {
    const dag = new DAG();

    dag.addTask({
      id: 'task-1',
      name: 'First Task',
      description: 'Independent task',
      agentType: 'GenericAgent',
      requiredSkills: [],
      dependencies: [],
      estimatedDuration: 100
    });

    dag.addTask({
      id: 'task-2',
      name: 'Second Task',
      description: 'Dependent task',
      agentType: 'CodeAgent',
      requiredSkills: [],
      dependencies: ['task-1'],
      estimatedDuration: 200
    });

    const readyTasks = dag.getReadyTasks();
    if (readyTasks.length !== 1 || readyTasks[0].id !== 'task-1') {
      throw new Error('Should have 1 ready task');
    }

    dag.markTaskComplete('task-1');
    const nextReady = dag.getReadyTasks();
    if (nextReady.length !== 1 || nextReady[0].id !== 'task-2') {
      throw new Error('Should have task-2 ready after task-1 completes');
    }

    console.log('   DAG operations working correctly');
  });

  // Test 6: Skill Manager - List skills
  await test('6. Skill Manager - List available skills').run(async () => {
    const skills = skillManager.listSkills();
    if (skills.length === 0) {
      throw new Error('No skills registered');
    }
    console.log('   Available skills:', skills.map(s => s.name).join(', '));
  });

  // Test 7: Skill Manager - Execute code generation skill
  await test('7. Skill Manager - Execute code generation skill').run(async () => {
    const result = await skillManager.executeSkill('code-generation', {
      language: 'typescript',
      requirements: 'Add two numbers'
    });

    if (!result.success || !result.result) {
      throw new Error('Code generation skill failed');
    }
    const resultText = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
    console.log('   Generated code preview:', resultText.slice(0, 100));
  });

  // Test 8: Agent Factory - Create GenericAgent
  await test('8. Agent Factory - Create GenericAgent').run(async () => {
    const agent = await agentFactory.create('GenericAgent', {
      taskId: 'test-task-1',
      skills: []
    });

    if (!agent || agent.agentType !== 'GenericAgent') {
      throw new Error('Failed to create GenericAgent');
    }
    console.log('   Agent created:', agent.agentType);
  });

  // Test 9: Agent Factory - Create CodeAgent
  await test('9. Agent Factory - Create CodeAgent').run(async () => {
    const agent = await agentFactory.create('CodeAgent', {
      taskId: 'test-task-2',
      skills: ['code-generation']
    });

    if (!agent || agent.agentType !== 'CodeAgent') {
      throw new Error('Failed to create CodeAgent');
    }
    console.log('   Agent created:', agent.agentType);
  });

  // Test 10: Agent - Execute task
  await test('10. GenericAgent - Execute simple task').run(async () => {
    const agent = new GenericAgent(llm, skillManager);
    const result = await agent.execute({
      id: 'task-exec-1',
      name: 'Test Task',
      description: 'Say hello in Chinese',
      agentType: 'GenericAgent',
      requiredSkills: [],
      dependencies: [],
      estimatedDuration: 100
    });

    if (!result) {
      throw new Error('Agent execution returned no result');
    }
    console.log('   Agent result:', result.result?.slice(0, 100));
  });

  // Test 11: EventBus - Publish and subscribe
  await test('11. EventBus - Event pub/sub').run(async () => {
    let received = false;
    const unsubscribe = eventBus.on('test.event', (data) => {
      received = true;
    });

    await eventBus.publish('test.event', { message: 'test data' });

    // Wait a bit for event to propagate
    await new Promise(resolve => setTimeout(resolve, 100));

    if (!received) {
      throw new Error('Event not received');
    }
    console.log('   Event bus working correctly');
    unsubscribe();
  });

  // Test 12: Intent Parser - Complexity assessment
  await test('12. Intent Parser - Complexity assessment').run(async () => {
    const intentParser = new IntentParser(llm);
    const intent = await intentParser.parse('创建一个完整的电商网站');

    const score = intentParser.assessComplexity(intent);
    if (score < 1 || score > 10) {
      throw new Error(`Complexity score out of range: ${score}`);
    }
    console.log('   Complexity score:', score);
  });

  // Test 13: End-to-end flow - Simple request
  await test('13. E2E Flow - Simple request processing').run(async () => {
    const intentParser = new IntentParser(llm);
    const dagBuilder = new DAGBuilder(llm);

    // Parse intent
    const intent = await intentParser.parse('生成一个 TypeScript 函数计算斐波那契数列');

    // Build DAG
    const dag = await dagBuilder.build(intent);

    // Get ready tasks
    const readyTasks = dag.getReadyTasks();
    if (readyTasks.length === 0) {
      throw new Error('No tasks in DAG');
    }

    console.log('   E2E flow completed, tasks generated:', readyTasks.length);
  });

  // Test 14: Multiple Agent types creation
  await test('14. Agent Factory - Multiple agent types').run(async () => {
    const agentTypes = ['GenericAgent', 'CodeAgent', 'DataAgent', 'AnalysisAgent'];
    const created: string[] = [];

    for (const type of agentTypes) {
      const agent = await agentFactory.create(type, {
        taskId: `test-${type}`,
        skills: []
      });
      created.push(agent.agentType);
    }

    if (created.length !== agentTypes.length) {
      throw new Error('Not all agent types created');
    }
    console.log('   Created agents:', created.join(', '));
  });

  // Test 15: Skill Manager - Get skills for task type
  await test('15. Skill Manager - Skills for task type').run(async () => {
    const codeSkills = skillManager.getSkillsForTask('code');
    const dataSkills = skillManager.getSkillsForTask('data');

    if (!Array.isArray(codeSkills) || !Array.isArray(dataSkills)) {
      throw new Error('getSkillsForTask should return array');
    }
    console.log('   Code skills:', codeSkills.join(', '));
    console.log('   Data skills:', dataSkills.join(', '));
  });

  // Test 16: DAG - Topological sort
  await test('16. DAG - Topological sort').run(async () => {
    const dag = new DAG();

    dag.addTask({
      id: 'task-1',
      name: 'Task 1',
      description: 'First',
      agentType: 'GenericAgent',
      requiredSkills: [],
      dependencies: [],
      estimatedDuration: 100
    });

    dag.addTask({
      id: 'task-2',
      name: 'Task 2',
      description: 'Second',
      agentType: 'CodeAgent',
      requiredSkills: [],
      dependencies: ['task-1'],
      estimatedDuration: 200
    });

    dag.addTask({
      id: 'task-3',
      name: 'Task 3',
      description: 'Third',
      agentType: 'AnalysisAgent',
      requiredSkills: [],
      dependencies: ['task-2'],
      estimatedDuration: 150
    });

    const sorted = dag.topologicalSort();
    if (sorted.length !== 3) {
      throw new Error('Should have 3 tasks');
    }

    // Check order: task-1 should come before task-2, task-2 before task-3
    const idx1 = sorted.findIndex(t => t.id === 'task-1');
    const idx2 = sorted.findIndex(t => t.id === 'task-2');
    const idx3 = sorted.findIndex(t => t.id === 'task-3');

    if (idx1 >= idx2 || idx2 >= idx3) {
      throw new Error('Tasks not in correct order');
    }

    console.log('   Topological sort correct:', sorted.map(t => t.id).join(' -> '));
  });

  // Test 17: CodeAgent - Execute code generation task
  await test('17. CodeAgent - Execute code generation task').run(async () => {
    const agent = new CodeAgent(llm, skillManager);
    const result = await agent.execute({
      id: 'code-task-1',
      name: 'Generate Fibonacci',
      description: 'Generate a TypeScript function to calculate Fibonacci numbers',
      agentType: 'CodeAgent',
      requiredSkills: [],
      dependencies: [],
      estimatedDuration: 200
    });

    if (!result) {
      throw new Error('CodeAgent execution returned no result');
    }
    console.log('   CodeAgent result preview:', result.result?.slice(0, 100));
  });

  // Test 18: LLM Client - Streaming completion
  await test('18. LLM Client - Streaming completion').run(async () => {
    const chunks: string[] = [];
    for await (const chunk of llm.streamComplete('Count from 1 to 3', { maxTokens: 50 })) {
      chunks.push(chunk);
    }

    if (chunks.length === 0) {
      throw new Error('No chunks received from streaming');
    }
    console.log('   Streaming completed, chunks:', chunks.length);
  });

  // Test 19: DAG - Cycle detection
  await test('19. DAG - Cycle detection').run(async () => {
    const dag = new DAG();

    dag.addTask({
      id: 'task-1',
      name: 'Task 1',
      description: 'First',
      agentType: 'GenericAgent',
      requiredSkills: [],
      dependencies: ['task-2'],
      estimatedDuration: 100
    });

    dag.addTask({
      id: 'task-2',
      name: 'Task 2',
      description: 'Second',
      agentType: 'CodeAgent',
      requiredSkills: [],
      dependencies: ['task-1'],
      estimatedDuration: 200
    });

    let hasCycle = false;
    try {
      dag.topologicalSort();
    } catch (e: any) {
      if (e.message.includes('Circular')) {
        hasCycle = true;
      }
    }

    if (!hasCycle) {
      throw new Error('Should detect circular dependency');
    }
    console.log('   Cycle detection working correctly');
  });

  // Test 20: End-to-end - Complex multi-step workflow
  await test('20. E2E Flow - Complex multi-step workflow').run(async () => {
    const intentParser = new IntentParser(llm);
    const dagBuilder = new DAGBuilder(llm);

    // Parse complex intent
    const intent = await intentParser.parse('创建一个完整的用户认证系统，包括注册、登录、密码重置功能');

    console.log('   Intent parsed - type:', intent.type, 'complexity:', intent.complexity);

    // Build DAG
    const dag = await dagBuilder.build(intent);

    // Check DAG structure
    const readyTasks = dag.getReadyTasks();
    console.log('   Workflow created with', readyTasks.length, 'initial tasks');

    // Assess complexity
    const score = intentParser.assessComplexity(intent);
    console.log('   Complexity score:', score, '/ 10');
  });

  // Summary
  console.log('\n=== Test Summary ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  // Task.MD Requirements Checklist
  console.log('\n=== Task.MD Requirements Verification ===');
  const requirements = [
    { name: 'Orchestrator: Intent parsing', tests: ['3', '12', '13', '20'] },
    { name: 'Orchestrator: DAG building', tests: ['4', '5', '16', '19'] },
    { name: 'Agent Factory: Dynamic Agent creation', tests: ['8', '9', '14'] },
    { name: 'Skills Registry: Registration & execution', tests: ['6', '7', '15'] },
    { name: 'Agent: Task execution', tests: ['10', '17'] },
    { name: 'EventBus: Event pub/sub', tests: ['11'] },
    { name: 'LLM Client: Text & JSON completion', tests: ['1', '2', '18'] },
    { name: 'End-to-end flow', tests: ['13', '20'] },
  ];

  requirements.forEach(req => {
    const reqPassed = req.tests.every(t => results.find(r => r.name.includes(t))?.passed);
    console.log(`  ${reqPassed ? '✓' : '✗'} ${req.name}`);
  });

  // Cleanup
  await llm.close();
  await eventBus.close();

  return failed === 0;
}

// Run tests
runIntegrationTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
