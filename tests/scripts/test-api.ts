/**
 * API Connection Test
 * 验证 LLM API 连接是否正常
 */

import { loadConfig } from './src/config/index.js';
import { LLMClient } from './src/llm/LLMClient.js';

async function testAPIConnection() {
  console.log('='.repeat(60));
  console.log('           API 连接测试');
  console.log('='.repeat(60));

  // 加载配置
  const config = loadConfig();

  console.log('\n[配置信息]');
  console.log(`  LLM 提供商: ${config.orchestrator.llmProvider}`);
  console.log(`  Base URL: ${config.orchestrator.llmConfig.baseURL}`);
  console.log(`  模型: ${config.orchestrator.llmConfig.model}`);
  console.log(`  API Key: ${config.orchestrator.llmConfig.apiKey ? config.orchestrator.llmConfig.apiKey.substring(0, 10) + '...' : '未设置'}`);

  // 检查 API key
  if (!config.orchestrator.llmConfig.apiKey || config.orchestrator.llmConfig.apiKey === 'your_api_key_here') {
    console.log('\n❌ 错误: API Key 未设置或为占位符');
    console.log('\n请执行以下步骤：');
    console.log('  1. 访问 https://open.bigmodel.cn/ 获取智谱 AI API Key');
    console.log('  2. 编辑 .env 文件，设置 ZHIPU_API_KEY=您的Key');
    console.log('  3. 重新运行测试');
    return false;
  }

  console.log('\n[测试 API 连接]');

  const llm = new LLMClient(config.orchestrator.llmConfig);

  try {
    const response = await llm.complete([
      {
        role: 'user',
        content: '你好，请用一句话回复：API连接正常'
      }
    ], {
      temperature: 0.3,
      maxTokens: 100
    });

    console.log('\n✅ API 连接成功！');
    console.log('\n[响应内容]');
    console.log(`  ${response.trim()}`);

    return true;
  } catch (error: any) {
    console.log('\n❌ API 连接失败！');
    console.log('\n[错误信息]');
    console.log(`  ${error.message}`);

    // 分析错误类型
    if (error.message.includes('401')) {
      console.log('\n[分析]');
      console.log('  错误类型: 认证失败');
      console.log('  可能原因: API Key 过期或无效');
      console.log('  解决方案: 请检查 .env 中的 ZHIPU_API_KEY 是否正确');
    } else if (error.message.includes('timeout')) {
      console.log('\n[分析]');
      console.log('  错误类型: 连接超时');
      console.log('  可能原因: 网络问题或 API 服务不可用');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.log('\n[分析]');
      console.log('  错误类型: 连接被拒绝');
      console.log('  可能原因: 网络配置问题或防火墙拦截');
    }

    return false;
  }
}

// 运行测试
testAPIConnection()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('\n[未捕获的错误]', error);
    process.exit(1);
  });
