/**
 * CLI Tool
 * Command-line interface for NexusAgent-Cluster
 */

import 'dotenv/config';
import { getOrchestrator } from './orchestrator/Orchestrator.js';
import { getBlackboard } from './state/Blackboard.js';
import { getSkillManager } from './skills/SkillManager.js';
import { loadConfig } from './config/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface CLIOptions {
  command: string;
  args: string[];
  options: Record<string, any>;
}

// 修复 Windows 命令行中文编码问题
function fixEncoding(text: string): string {
  // 检测是否是乱码（如果包含替换字符则可能是编码问题）
  if (text.includes('') || text.includes('')) {
    // 尝试使用 iconv-lite 或其他方法修复
    // 这里简单地用 Buffer 重新编码
    try {
      const buffer = Buffer.from(text, 'latin1');
      return buffer.toString('utf8');
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Main CLI entry point
 */
async function main() {
  // 设置控制台输出编码为 UTF-8
  if (process.platform === 'win32') {
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
  }

  const args = process.argv.slice(2);
  const [command, ...commandArgs] = args;

  const cli: CLIOptions = {
    command: command || 'help',
    args: commandArgs,
    options: parseOptions(commandArgs),
  };

  try {
    await executeCommand(cli);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Parse command options
 */
function parseOptions(args: string[]): Record<string, any> {
  const options: Record<string, any> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        options[key] = nextArg;
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  return options;
}

/**
 * Execute CLI command
 */
async function executeCommand(cli: CLIOptions): Promise<void> {
  switch (cli.command) {
    case 'run':
      await cmdRun(cli.args, cli.options);
      break;

    case 'chat':
    case 'repl':
    case 'interactive':
      await cmdChat();
      break;

    case 'status':
      await cmdStatus();
      break;

    case 'test':
      await cmdTest(cli.args);
      break;

    case 'skills':
      await cmdSkills(cli.args, cli.options);
      break;

    case 'skill':
      await cmdSkill(cli.args, cli.options);
      break;

    case 'clean':
      await cmdClean();
      break;

    case 'help':
    default:
      printHelp();
      break;
  }
}

/**
 * Interactive chat mode
 */
async function cmdChat(): Promise<void> {
  const readline = await import('readline');
  const getOrchestrator = (await import('./orchestrator/Orchestrator.js')).getOrchestrator;
  const getBlackboard = (await import('./state/Blackboard.js')).getBlackboard;
  const getSkillManager = (await import('./skills/SkillManager.js')).getSkillManager;
  const loadConfig = (await import('./config/index.js')).loadConfig;

  const config = loadConfig();
  const orchestrator = getOrchestrator();
  const blackboard = getBlackboard();
  const skillManager = getSkillManager();

  // 初始化
  await orchestrator.initialize();
  await skillManager.initialize();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 生成会话 ID
  const sessionId = `chat-${Date.now()}`;

  // 清屏并显示欢迎界面
  console.clear();
  console.log('\n' + '='.repeat(60));
  console.log('           NexusAgent-Cluster 交互式界面');
  console.log('='.repeat(60));
  console.log(`\n  会话 ID: ${sessionId}`);
  console.log(`  LLM 提供商: ${config.orchestrator.llmProvider}`);
  console.log(`  模型: ${config.orchestrator.llmConfig.model}`);
  console.log(`  最大并行 Agent: ${config.cluster.maxParallelAgents}`);

  // 显示系统状态
  try {
    const sessions = await blackboard.getAllSessions();
    const skillStats = skillManager.getStats();

    console.log(`\n  ┌─ 系统状态 ──────────────────────────────`);
    console.log(`  │ 活跃会话: ${sessions.length}`);
    console.log(`  │ 可用技能: ${skillStats.enabled}/${skillStats.total}`);
    console.log(`  │ 内置技能: ${skillStats.builtin}`);
    console.log(`  │ 自定义技能: ${skillStats.external}`);
    console.log(`  └──────────────────────────────────────`);
  } catch (error: any) {
    console.log(`\n  ⚠ Redis 连接状态: ${error.message || '未连接'}`);
  }

  console.log('\n' + '-'.repeat(60));
  console.log('  命令:');
  console.log('    直接输入任务描述 - 执行任务');
  console.log('    /status          - 查看系统状态');
  console.log('    /skills          - 列出可用技能');
  console.log('    /session         - 查看当前会话信息');
  console.log('    /clear           - 清屏');
  console.log('    /exit 或 /quit   - 退出');
  console.log('-'.repeat(60) + '\n');

  // 历史记录
  const history: string[] = [];
  let taskCount = 0;

  // 主循环
  while (true) {
    const userInput = await new Promise<string>((resolve) => {
      rl.question('\x1b[1;36mYou>\x1b[0m ', (answer) => resolve(answer));
    });

    // 检查命令
    const trimmedInput = userInput.trim();

    if (!trimmedInput) {
      continue;
    }

    // 处理斜杠命令
    if (trimmedInput.startsWith('/')) {
      const [command] = trimmedInput.split(' ');

      switch (command) {
        case '/exit':
        case '/quit':
        case '/q':
          rl.close();
          await orchestrator.shutdown();
          console.log('\n\x1b[1;32m✓ 已安全退出\x1b[0m\n');
          process.exit(0);

        case '/clear':
        case '/cls':
          console.clear();
          console.log('\n' + '='.repeat(60));
          console.log('           NexusAgent-Cluster 交互式界面');
          console.log('='.repeat(60) + '\n');
          break;

        case '/status':
          try {
            const allSessions = await blackboard.getAllSessions();
            const state = await blackboard.getState(sessionId);

            console.log('\n  ┌─ 系统状态 ──────────────────────────────');
            console.log(`  │ 总会话数: ${allSessions.length}`);
            if (state) {
              console.log(`  │ 当前会话任务: ${state.metrics.totalTasks}`);
              console.log(`  │ 已完成: ${state.metrics.completedTasks}`);
              console.log(`  │ 状态: ${state.status}`);
            }
            console.log(`  └──────────────────────────────────────\n`);
          } catch (error: any) {
            console.log(`  ⚠ 无法获取状态: ${error.message}\n`);
          }
          break;

        case '/skills':
          const skills = skillManager.listSkills();
          const byCategory: Record<string, any[]> = {};

          for (const skill of skills) {
            if (!byCategory[skill.category]) {
              byCategory[skill.category] = [];
            }
            byCategory[skill.category].push(skill);
          }

          console.log('\n  ┌─ 可用技能 ──────────────────────────────');
          for (const [category, categorySkills] of Object.entries(byCategory)) {
            console.log(`  │ \n  │ [${category.toUpperCase()}]`);
            for (const skill of categorySkills.slice(0, 5)) {
              const status = skill.enabled ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
              console.log(`  │   ${status} ${skill.name}`);
            }
            if (categorySkills.length > 5) {
              console.log(`  │   ... 还有 ${categorySkills.length - 5} 个`);
            }
          }
          console.log(`  │ \n  │ 总计: ${skills.length} 个技能`);
          console.log(`  └──────────────────────────────────────\n`);
          break;

        case '/session':
          try {
            const state = await blackboard.getState(sessionId);
            if (state) {
              console.log('\n  ┌─ 当前会话 ──────────────────────────────');
              console.log(`  │ 会话 ID: ${state.sessionId}`);
              console.log(`  │ 状态: ${state.status}`);
              console.log(`  │ 总任务: ${state.metrics.totalTasks}`);
              console.log(`  │ 已完成: ${state.metrics.completedTasks}`);
              console.log(`  │ 创建时间: ${state.createdAt.toLocaleString('zh-CN')}`);
              console.log(`  │ 更新时间: ${state.updatedAt.toLocaleString('zh-CN')}`);
              console.log(`  └──────────────────────────────────────\n`);
            } else {
              console.log('  当前会话暂无数据\n');
            }
          } catch (error: any) {
            console.log(`  ⚠ 无法获取会话信息: ${error.message}\n`);
          }
          break;

        case '/help':
          console.log('\n  可用命令:');
          console.log('    /status  - 查看系统状态');
          console.log('    /skills  - 列出可用技能');
          console.log('    /session - 查看当前会话信息');
          console.log('    /clear   - 清屏');
          console.log('    /exit    - 退出\n');
          break;

        default:
          console.log(`  \x1b[33m未知命令: ${command}\x1b[0m`);
          console.log('  输入 /help 查看可用命令\n');
      }
      continue;
    }

    // 执行任务
    taskCount++;
    const startTime = Date.now();

    console.log(`\n\x1b[1;33m[${new Date().toLocaleTimeString('zh-CN')}] 执行任务 #${taskCount}\x1b[0m`);
    console.log(`\x1b[90m输入: ${trimmedInput.substring(0, 100)}${trimmedInput.length > 100 ? '...' : ''}\x1b[0m`);
    console.log('\x1b[1;36mAgent>\x1b[0m');

    try {
      const result = await orchestrator.processRequest({
        sessionId,
        userInput: trimmedInput,
        context: {},
      });

      const elapsed = Date.now() - startTime;

      // 显示结果
      if (result.success) {
        // 优先显示响应文本
        if (result.data?.response) {
          console.log(result.data.response);
        } else if (result.data?.tasks && result.data.tasks.length > 0) {
          // 如果没有 response 字段，显示任务结果
          console.log(JSON.stringify(result.data, null, 2));
        } else {
          console.log(JSON.stringify(result.data, null, 2));
        }
        console.log(`\n\x1b[1;32m✓ 完成 (${(elapsed / 1000).toFixed(2)}s)\x1b[0m`);
      } else {
        console.log(`\n\x1b[1;31m✗ 失败: ${result.error || '未知错误'}\x1b[0m`);
      }

      // 保存历史
      history.push(trimmedInput);
    } catch (error: any) {
      console.log(`\n\x1b[1;31m✗ 错误: ${error.message}\x1b[0m`);
    }
  }
}

/**
 * Run a single task
 */
async function cmdRun(args: string[], options: Record<string, any>): Promise<void> {
  let prompt = args[0];

  // 支持从文件读取输入（解决 Windows 命令行中文编码问题）
  if (!prompt) {
    console.error('Error: Missing prompt argument');
    console.log('\nUsage:');
    console.log('  pnpm cli run "your prompt"');
    console.log('  pnpm cli run --file prompt.txt');
    console.log('  pnpm cli run --interactive');
    console.log('\n提示: Windows 用户建议使用 --file 或 --interactive 模式避免中文编码问题');
    process.exit(1);
  }

  // 处理 --file 选项
  if (prompt === '--file' && args[1]) {
    try {
      const filePath = resolve(args[1]);
      prompt = readFileSync(filePath, 'utf-8');
      console.log(`从文件读取任务: ${filePath}`);
    } catch (error: any) {
      console.error(`读取文件失败: ${error.message}`);
      process.exit(1);
    }
  }

  // 处理 --interactive 选项
  if (prompt === '--interactive') {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    prompt = await new Promise<string>((resolve) => {
      rl.question('请输入任务描述: ', (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  // 修复编码（主要针对 Windows）
  prompt = fixEncoding(prompt);

  const orchestrator = getOrchestrator();

  await orchestrator.initialize();

  const sessionId = `cli-${Date.now()}`;

  console.log(`Executing task: ${prompt}`);
  console.log(`Session ID: ${sessionId}`);
  console.log('---');

  const result = await orchestrator.processRequest({
    sessionId,
    userInput: prompt,
    context: options,
  });

  console.log('---');
  console.log('Result:');
  console.log(JSON.stringify(result, null, 2));

  await orchestrator.shutdown();
}

/**
 * Show system status
 */
async function cmdStatus(): Promise<void> {
  const config = loadConfig();
  const blackboard = getBlackboard();
  const skillManager = getSkillManager();

  console.log('\n=== NexusAgent-Cluster Status ===\n');
  console.log(`LLM Provider: ${config.orchestrator.llmProvider}`);
  console.log(`Model: ${config.orchestrator.llmConfig.model}`);
  console.log(`Max Parallel Agents: ${config.cluster.maxParallelAgents}`);
  console.log(`Redis: ${config.storage.redisUrl}`);

  try {
    const sessions = await blackboard.getAllSessions();
    console.log(`\nActive Sessions: ${sessions.length}`);

    if (sessions.length > 0) {
      console.log('\nSessions:');
      for (const sessionId of sessions.slice(0, 10)) {
        const state = await blackboard.getState(sessionId);
        if (state) {
          console.log(`  - ${sessionId}: ${state.status} (${state.metrics.completedTasks}/${state.metrics.totalTasks} tasks)`);
        }
      }
    }
  } catch (error: any) {
    console.log(`\nRedis Status: Error (${error.message})`);
  }

  // Skill statistics
  const stats = skillManager.getStats();
  console.log(`\nSkill Statistics:`);
  console.log(`  Total Skills: ${stats.total}`);
  console.log(`  Built-in: ${stats.builtin}`);
  console.log(`  External: ${stats.external}`);
  console.log(`  Enabled: ${stats.enabled}`);
  console.log(`  Disabled: ${stats.disabled}`);
  console.log(`  By Category:`);
  for (const [category, count] of Object.entries(stats.byCategory)) {
    console.log(`    ${category}: ${count}`);
  }
}

/**
 * List skills command
 * Usage: skills [list|search|stats] [query]
 */
async function cmdSkills(args: string[], options: Record<string, any>): Promise<void> {
  const skillManager = getSkillManager();
  await skillManager.initialize(); // Ensure skill manager is initialized

  const subcommand = args[0] || 'list';
  const query = args[1];

  switch (subcommand) {
    case 'list':
      await cmdSkillsList(skillManager, options);
      break;
    case 'search':
      if (!query) {
        console.error('Error: Search query required');
        console.log('Usage: npm run cli skills search <query>');
        process.exit(1);
      }
      await cmdSkillsSearch(skillManager, query);
      break;
    case 'stats':
      await cmdSkillsStats(skillManager);
      break;
    case 'packages':
      await cmdSkillsPackages(skillManager);
      break;
    default:
      await cmdSkillsList(skillManager, options);
  }
}

/**
 * List all skills
 */
async function cmdSkillsList(skillManager: any, options: Record<string, any>): Promise<void> {
  const skills = skillManager.listSkills();
  const showExternal = options.external || options.e;
  const showBuiltin = options.builtin || options.b;

  let filteredSkills = skills;
  if (showExternal) {
    filteredSkills = skillManager.listExternalSkills();
  } else if (showBuiltin) {
    filteredSkills = skillManager.listBuiltinSkills();
  }

  console.log('\n=== Available Skills ===\n');

  const byCategory: Record<string, any[]> = {};
  for (const skill of filteredSkills) {
    if (!byCategory[skill.category]) {
      byCategory[skill.category] = [];
    }
    byCategory[skill.category].push(skill);
  }

  for (const [category, categorySkills] of Object.entries(byCategory)) {
    console.log(`\n${category.toUpperCase()}:`);
    for (const skill of categorySkills) {
      const status = skill.enabled ? '✓' : '✗';
      const builtin = skill.builtin ? '[builtin]' : '[custom]';
      const version = skill.version ? ` v${skill.version}` : '';
      console.log(`  ${status} ${skill.name}${version} ${builtin}`);
      console.log(`     ${skill.description}`);
    }
  }

  console.log(`\nTotal: ${filteredSkills.length} skills`);
  console.log('Tip: Use --all/-a to show all, --external/-e for custom skills only, --builtin/-b for built-in only');
  console.log('      Use "skills search <query>" to search skills');
  console.log('      Use "skills stats" for detailed statistics');
}

/**
 * Search skills
 */
async function cmdSkillsSearch(skillManager: any, query: string): Promise<void> {
  const results = skillManager.searchSkills(query);

  console.log(`\n=== Search Results for "${query}" ===\n`);

  if (results.length === 0) {
    console.log('No skills found.');
    return;
  }

  for (const skill of results) {
    const status = skill.enabled ? '✓' : '✗';
    const builtin = skill.builtin ? '[builtin]' : '[custom]';
    console.log(`${status} ${skill.name} ${builtin} - ${skill.description}`);
    if (skill.parameters?.required?.length) {
      console.log(`   Required params: ${skill.parameters.required.join(', ')}`);
    }
  }

  console.log(`\nFound ${results.length} skill(s)`);
}

/**
 * Show skill statistics
 */
async function cmdSkillsStats(skillManager: any): Promise<void> {
  const stats = skillManager.getStats();
  const packages = skillManager.listSkillPackages();

  console.log('\n=== Skill Statistics ===\n');

  console.log('Overview:');
  console.log(`  Total Skills: ${stats.total}`);
  console.log(`  Built-in: ${stats.builtin}`);
  console.log(`  External/Custom: ${stats.external}`);
  console.log(`  Enabled: ${stats.enabled}`);
  console.log(`  Disabled: ${stats.disabled}`);

  console.log('\nBy Category:');
  for (const [category, count] of Object.entries(stats.byCategory)) {
    const countNum = count as number;
    const percentage = ((countNum / stats.total) * 100).toFixed(1);
    console.log(`  ${category}: ${countNum} (${percentage}%)`);
  }

  if (packages.length > 0) {
    console.log('\nExternal Skill Packages:');
    for (const pkg of packages) {
      console.log(`  - ${pkg.name} v${pkg.version}`);
      console.log(`    ${pkg.description}`);
      console.log(`    Skills: ${pkg.skills.join(', ')}`);
    }
  }
}

/**
 * List skill packages
 */
async function cmdSkillsPackages(skillManager: any): Promise<void> {
  const packages = skillManager.listSkillPackages();

  console.log('\n=== Skill Packages ===\n');

  if (packages.length === 0) {
    console.log('No external skill packages installed.');
    console.log('\nTip: Create a "skills/" directory to add custom skills.');
    return;
  }

  for (const pkg of packages) {
    console.log(`\n${pkg.name} v${pkg.version}`);
    console.log(`  Description: ${pkg.description}`);
    if (pkg.author) {
      console.log(`  Author: ${pkg.author}`);
    }
    console.log(`  Skills: ${pkg.skills.join(', ')}`);
    if (pkg.permissions?.length) {
      console.log(`  Permissions: ${pkg.permissions.join(', ')}`);
    }
  }
}

/**
 * Single skill management command
 * Usage: skill <info|enable|disable|test> <skill-name>
 */
async function cmdSkill(args: string[], options: Record<string, any>): Promise<void> {
  const skillManager = getSkillManager();
  await skillManager.initialize(); // Ensure skill manager is initialized

  const subcommand = args[0];
  const skillName = args[1];

  if (!subcommand) {
    console.error('Error: Subcommand required');
    console.log('Usage: npm run cli skill <info|enable|disable|test> <skill-name>');
    process.exit(1);
  }

  switch (subcommand) {
    case 'info':
      if (!skillName) {
        console.error('Error: Skill name required');
        process.exit(1);
      }
      await cmdSkillInfo(skillManager, skillName);
      break;

    case 'enable':
      if (!skillName) {
        console.error('Error: Skill name required');
        process.exit(1);
      }
      await cmdSkillEnable(skillManager, skillName);
      break;

    case 'disable':
      if (!skillName) {
        console.error('Error: Skill name required');
        process.exit(1);
      }
      await cmdSkillDisable(skillManager, skillName);
      break;

    case 'test':
      if (!skillName) {
        console.error('Error: Skill name required');
        process.exit(1);
      }
      await cmdSkillTest(skillManager, skillName, options.params);
      break;

    default:
      console.error(`Error: Unknown subcommand "${subcommand}"`);
      console.log('Available subcommands: info, enable, disable, test');
      process.exit(1);
  }
}

/**
 * Show skill info
 */
async function cmdSkillInfo(skillManager: any, skillName: string): Promise<void> {
  const skill = skillManager.getSkill(skillName);

  if (!skill) {
    console.error(`Skill "${skillName}" not found`);
    console.log('Tip: Use "npm run cli skills list" to see all available skills');
    process.exit(1);
  }

  console.log(`\n=== Skill: ${skill.name} ===\n`);
  console.log(`Name: ${skill.name}`);
  console.log(`Version: ${skill.version}`);
  console.log(`Category: ${skill.category}`);
  console.log(`Description: ${skill.description}`);
  console.log(`Enabled: ${skill.enabled ? 'Yes' : 'No'}`);
  console.log(`Built-in: ${skill.builtin ? 'Yes' : 'No'}`);

  if (skill.parameters) {
    console.log('\nParameters:');
    if (skill.parameters.required?.length) {
      console.log(`  Required: ${skill.parameters.required.join(', ')}`);
    }
    if (skill.parameters.optional?.length) {
      console.log(`  Optional: ${skill.parameters.optional.join(', ')}`);
    }
  }
}

/**
 * Enable a skill
 */
async function cmdSkillEnable(skillManager: any, skillName: string): Promise<void> {
  if (!skillManager.hasSkill(skillName)) {
    console.error(`Skill "${skillName}" not found`);
    process.exit(1);
  }

  const success = skillManager.enableSkill(skillName);
  if (success) {
    console.log(`✓ Skill "${skillName}" enabled successfully`);
  } else {
    console.error(`✗ Failed to enable skill "${skillName}"`);
    process.exit(1);
  }
}

/**
 * Disable a skill
 */
async function cmdSkillDisable(skillManager: any, skillName: string): Promise<void> {
  if (!skillManager.hasSkill(skillName)) {
    console.error(`Skill "${skillName}" not found`);
    process.exit(1);
  }

  const success = skillManager.disableSkill(skillName);
  if (success) {
    console.log(`✓ Skill "${skillName}" disabled successfully`);
  } else {
    console.error(`✗ Failed to disable skill "${skillName}"`);
    process.exit(1);
  }
}

/**
 * Test a skill
 */
async function cmdSkillTest(skillManager: any, skillName: string, paramsStr?: string): Promise<void> {
  const skill = skillManager.getSkill(skillName);

  if (!skill) {
    console.error(`Skill "${skillName}" not found`);
    process.exit(1);
  }

  console.log(`Testing skill: ${skillName}\n`);

  let params: any = {};
  if (paramsStr) {
    try {
      params = JSON.parse(paramsStr);
    } catch {
      console.error('Error: Invalid JSON in params');
      process.exit(1);
    }
  } else {
    // Use default test params based on skill
    params = getDefaultTestParams(skillName);
  }

  console.log(`Parameters: ${JSON.stringify(params, null, 2)}\n`);

  const result = await skillManager.executeSkill(skillName, params, {
    sessionId: 'test-session',
    taskId: 'test-task',
  });

  console.log('Result:');
  console.log(`  Success: ${result.success}`);
  if (result.result) {
    console.log(`  Output: ${JSON.stringify(result.result, null, 2)}`);
  }
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }
  if (result.metadata) {
    console.log(`  Metadata: ${JSON.stringify(result.metadata, null, 2)}`);
  }
}

/**
 * Get default test parameters for a skill
 */
function getDefaultTestParams(skillName: string): any {
  const defaults: Record<string, any> = {
    'code-generation': {
      language: 'typescript',
      requirements: 'Create a function that adds two numbers',
    },
    'file-ops': {
      operation: 'read',
      path: 'package.json',
    },
    'terminal-exec': {
      command: 'echo "Hello from skill test"',
    },
    'code-review': {
      code: 'function add(a, b) { return a + b; }',
      language: 'javascript',
    },
    'data-analysis': {
      analysisType: 'general',
      data: 'Sample data for testing',
    },
  };

  return defaults[skillName] || {};
}

/**
 * Run tests
 */
async function cmdTest(_args: string[]): Promise<void> {
  console.log('Running tests...');
  // Would trigger vitest here
  console.log('Tests not implemented yet');
}

/**
 * Clean Redis data
 */
async function cmdClean(): Promise<void> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('This will delete all Nexus data from Redis. Continue? (yes/no): ', async (answer) => {
    rl.close();

    if (answer.toLowerCase() === 'yes') {
      const blackboard = getBlackboard();
      const sessions = await blackboard.getAllSessions();

      for (const sessionId of sessions) {
        await blackboard.deleteSession(sessionId);
      }

      console.log(`Deleted ${sessions.length} sessions`);
    } else {
      console.log('Clean cancelled');
    }

    process.exit(0);
  });
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
NexusAgent-Cluster CLI

Usage: npm run cli <command> [options]

Commands:
  chat, repl             Interactive chat mode (REPL)
  run <prompt>           Execute a single task
  status                 Show system status
  skills [list]          List available skills
  skills search <query>  Search skills by name or description
  skills stats           Show skill statistics
  skills packages        List external skill packages
  skill info <name>      Show detailed skill information
  skill enable <name>    Enable a skill
  skill disable <name>   Disable a skill
  skill test <name>      Test a skill execution
  test                   Run tests
  clean                  Clean Redis data
  help                   Show this help message

Examples:
  pnpm cli chat                 Start interactive mode
  pnpm cli run "创建一个RESTful API"
  pnpm cli status
  pnpm cli skills list
  pnpm cli skills search "code"
  pnpm cli skill info code-generation
  pnpm cli skill test file-ops

Interactive Commands (in chat mode):
  /status                Show system status
  /skills                List available skills
  /session               Show current session info
  /clear                 Clear screen
  /exit, /quit           Exit interactive mode

Options:
  skills list:
    --all, -a         Show all skills including disabled
    --external, -e    Show only external/custom skills
    --builtin, -b     Show only built-in skills

  skill test:
    --params <json>   Test with custom parameters (JSON string)

Environment:
  ZHIPU_API_KEY       Zhipu AI API key
  DEEPSEEK_API_KEY    DeepSeek API key
  OPENAI_API_KEY      OpenAI API key
  REDIS_URL           Redis connection URL
  LOG_LEVEL           Logging level (debug, info, warn, error)
`);
}

// Run CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
