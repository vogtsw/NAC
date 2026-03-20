/**
 * 快速 E2E 测试
 * 使用简单输入减少 LLM 调用次数
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Orchestrator } from '../src/orchestrator/Orchestrator.js';

describe('Quick E2E Tests', () => {
  let orchestrator: Orchestrator;

  beforeAll(async () => {
    orchestrator = new Orchestrator({
      maxParallelAgents: 1, // 减少并发，降低复杂度
    });

    await orchestrator.initialize();
  });

  it('should handle simple conversation quickly', async () => {
    const sessionId = `quick-${Date.now()}`;
    const result = await orchestrator.processRequest({
      sessionId,
      userInput: '你好', // 简单对话，跳过 DAG 构建
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    console.log('Quick E2E Result:', result);
  }, 10000); // 10 秒超时

  it('should handle simple analysis task', async () => {
    const sessionId = `analysis-${Date.now()}`;
    const result = await orchestrator.processRequest({
      sessionId,
      userInput: '帮我分析一个函数', // 简单任务，减少 DAG 复杂度
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    console.log('Analysis E2E Result:', result);
  }, 90000); // 90 秒超时（增加时间）
});
