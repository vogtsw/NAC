/**
 * OpenClaw Technology Research Script
 * Uses LLM to research and analyze OpenClaw technology
 */

import { LLMClient } from '../src/llm/LLMClient.js';
import { loadConfig } from '../src/config/index.js';

const config = loadConfig();
const llm = new LLMClient(config.orchestrator.llmConfig);

async function researchOpenClaw() {
  console.log('=== OpenClaw 技术调研分析 ===\n');

  // Step 1: 技术背景调研
  console.log('Step 1: 技术背景调研...');
  const background = await llm.complete(
    `请详细调研 OpenClaw 技术，包括：
1. OpenClaw 是什么？它的官方定义和背景
2. OpenClaw 的技术架构和核心组件
3. OpenClaw 使用的编程语言和主要依赖
4. OpenClaw 的开发团队和社区情况

请提供详细、准确的信息。`,
    { maxTokens: 2000, temperature: 0.5 }
  );
  console.log(background);
  console.log('\n---\n');

  // Step 2: 核心功能分析
  console.log('Step 2: 核心功能分析...');
  const features = await llm.complete(
    `请详细分析 OpenClaw 的核心功能特性：
1. OpenClaw 提供哪些主要功能和 API？
2. OpenClaw 的技术特点和创新点
3. OpenClaw 与类似技术的区别
4. OpenClaw 的主要使用场景

请提供详细的功能分析。`,
    { maxTokens: 2000, temperature: 0.5 }
  );
  console.log(features);
  console.log('\n---\n');

  // Step 3: 优缺点分析
  console.log('Step 3: 优缺点分析...');
  const prosCons = await llm.complete(
    `请客观分析 OpenClaw 技术的优势和劣势：
1. OpenClaw 的主要优势
2. OpenClaw 的局限性或缺点
3. OpenClaw 面临的技术挑战
4. OpenClaw 的发展前景和趋势

请提供平衡、客观的分析。`,
    { maxTokens: 2000, temperature: 0.5 }
  );
  console.log(prosCons);
  console.log('\n---\n');

  // Step 4: 应用场景
  console.log('Step 4: 应用场景分析...');
  const scenarios = await llm.complete(
    `请分析 OpenClaw 的实际应用场景：
1. OpenClaw 适合用于什么样的项目？
2. 哪些行业或领域在使用 OpenClaw？
3. OpenClaw 的典型使用案例
4. OpenClaw 的商业化程度

请提供具体的应用场景分析。`,
    { maxTokens: 2000, temperature: 0.5 }
  );
  console.log(scenarios);
  console.log('\n---\n');

  // Step 5: 综合评估
  console.log('Step 5: 综合评估与建议...');
  const summary = await llm.complete(
    `基于以上调研，请对 OpenClaw 技术进行综合评估：
1. 技术成熟度评估
2. 推荐使用指数 (1-10分)
3. 适合什么样的开发者或团队使用
4. 学习曲线和入门难度
5. 总结和建议

请提供简洁明了的综合评估。`,
    { maxTokens: 1500, temperature: 0.5 }
  );
  console.log(summary);
  console.log('\n=== 调研完成 ===');

  await llm.close();
}

// Run research
researchOpenClaw().catch((error) => {
  console.error('调研过程中出错:', error);
  process.exit(1);
});
