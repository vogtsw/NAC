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
    if (typeof process.stdout.setEncoding === 'function') {
      process.stdout.setEncoding('utf8');
    }
    if (typeof process.stderr.setEncoding === 'function') {
      process.stderr.setEncoding('utf8');
    }
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

    case 'user':
      await cmdUser(cli.args, cli.options);
      break;

    case 'schedule':
    case 'scheduled':
      await cmdSchedule(cli.args, cli.options);
      break;

    case 'serve':
    case 'server':
      await cmdServe(cli.args, cli.options);
      break;

    case 'gateway':
      await cmdGateway(cli.args, cli.options);
      break;

    case 'feedback':
      await cmdFeedback(cli.args, cli.options);
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
    case 'install':
      await cmdSkillInstall(args.slice(1), options);
      break;
    case 'remove':
    case 'uninstall':
      await cmdSkillRemove(args.slice(1));
      break;
    case 'update':
      await cmdSkillUpdate(args.slice(1));
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
 * Install a skill from various sources
 * Usage: skills install <npm|git|local|mcp> [options]
 */
async function cmdSkillInstall(args: string[], options: Record<string, any>): Promise<void> {
  const { getSkillInstaller } = await import('./skills/SkillInstaller.js');
  const installer = getSkillInstaller();

  const source = args[0] as 'npm' | 'git' | 'local' | 'mcp';

  if (!source) {
    console.error('\nError: Installation source required\n');
    console.log('Usage: npm run cli skills install <source> [options]\n');
    console.log('Sources:');
    console.log('  npm    <package>[@version]  Install from npm package');
    console.log('  git    <repo-url>          Install from git repository');
    console.log('  local  <path>              Install from local directory');
    console.log('  mcp    <name> [--url]      Create MCP server skill\n');
    console.log('Examples:');
    console.log('  pnpm cli skills install npm @nexus-skills/github');
    console.log('  pnpm cli skills install npm nexus-skill-weather@1.0.0');
    console.log('  pnpm cli skills install git https://github.com/user/skills.git');
    console.log('  pnpm cli skills install local ./my-skill');
    console.log('  pnpm cli skills install mcp my-server --url ws://localhost:3000');
    process.exit(1);
  }

  const installOptions: any = { source };

  switch (source) {
    case 'npm':
      const pkg = args[1];
      if (!pkg) {
        console.error('Error: Package name required');
        console.log('Usage: pnpm cli skills install npm <package>[@version]');
        process.exit(1);
      }
      const [name, version] = pkg.split('@');
      installOptions.name = name;
      installOptions.version = version || 'latest';
      break;

    case 'git':
      const url = args[1];
      const gitName = options.name;
      if (!url) {
        console.error('Error: Git repository URL required');
        console.log('Usage: pnpm cli skills install git <repo-url> [--name <name>]');
        process.exit(1);
      }
      installOptions.url = url;
      if (gitName) installOptions.name = gitName;
      break;

    case 'local':
      const path = args[1];
      const localName = options.name;
      if (!path) {
        console.error('Error: Local path required');
        console.log('Usage: pnpm cli skills install local <path> [--name <name>]');
        process.exit(1);
      }
      installOptions.path = path;
      if (localName) installOptions.name = localName;
      break;

    case 'mcp':
      const mcpName = args[1];
      if (!mcpName) {
        console.error('Error: MCP server name required');
        console.log('Usage: pnpm cli skills install mcp <name> [--url <url>]');
        process.exit(1);
      }
      installOptions.name = mcpName;
      if (options.url) installOptions.url = options.url;
      break;
  }

  if (options.force) installOptions.force = true;

  console.log(`\nInstalling skill from ${source}...`);
  const result = await installer.install(installOptions);

  if (result.success) {
    console.log(`\n✓ ${result.message}`);
    if (result.installedPath) {
      console.log(`  Path: ${result.installedPath}`);
    }
    console.log('\nTip: Restart the application to load the new skill');
  } else {
    console.error(`\n✗ ${result.message}`);
    process.exit(1);
  }
}

/**
 * Remove an installed skill
 * Usage: skills remove <skill-name>
 */
async function cmdSkillRemove(args: string[]): Promise<void> {
  const { getSkillInstaller } = await import('./skills/SkillInstaller.js');
  const installer = getSkillInstaller();

  const skillName = args[0];

  if (!skillName) {
    console.error('Error: Skill name required');
    console.log('Usage: pnpm cli skills remove <skill-name>');
    process.exit(1);
  }

  // Check if skill is built-in
  const skillManager = getSkillManager();
  await skillManager.initialize();
  const skill = skillManager.getSkill(skillName);

  if (skill?.builtin) {
    console.error(`\n✗ Cannot remove built-in skill: ${skillName}`);
    console.log('Built-in skills cannot be removed. You can disable them with:');
    console.log(`  pnpm cli skill disable ${skillName}`);
    process.exit(1);
  }

  const result = await installer.remove(skillName);

  if (result.success) {
    console.log(`\n✓ ${result.message}`);
    console.log('\nTip: Restart the application to apply changes');
  } else {
    console.error(`\n✗ ${result.message}`);
    process.exit(1);
  }
}

/**
 * Update a skill from git
 * Usage: skills update <skill-name>
 */
async function cmdSkillUpdate(args: string[]): Promise<void> {
  const { getSkillInstaller } = await import('./skills/SkillInstaller.js');
  const installer = getSkillInstaller();

  const skillName = args[0];

  if (!skillName) {
    console.error('Error: Skill name required');
    console.log('Usage: pnpm cli skills update <skill-name>');
    process.exit(1);
  }

  console.log(`\nUpdating skill: ${skillName}...`);
  const result = await installer.update(skillName);

  if (result.success) {
    console.log(`\n✓ ${result.message}`);
    console.log('\nTip: Restart the application to apply changes');
  } else {
    console.error(`\n✗ ${result.message}`);
    process.exit(1);
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
 * User management command
 * Usage: user <profile|preferences|history|stats> [userId]
 */
async function cmdUser(args: string[], options: Record<string, any>): Promise<void> {
  const { getUserProfile } = await import('./state/UserProfile.js');
  const subcommand = args[0] || 'profile';
  const userId = options.user || options.u || 'default';

  const profile = getUserProfile(userId);
  await profile.initialize();

  switch (subcommand) {
    case 'profile':
      await cmdUserProfile(profile);
      break;

    case 'preferences':
    case 'prefs':
      await cmdUserPreferences(profile, args.slice(1));
      break;

    case 'history':
      await cmdUserHistory(profile, parseInt(options.limit || '10'));
      break;

    case 'stats':
      await cmdUserStats(profile);
      break;

    case 'update':
      await cmdUserUpdate(profile, args.slice(1));
      break;

    default:
      console.error(`Error: Unknown subcommand "${subcommand}"`);
      console.log('Available subcommands: profile, preferences, history, stats, update');
      break;
  }
}

/**
 * Show user profile
 */
async function cmdUserProfile(profile: any): Promise<void> {
  const data = profile.exportData();
  const parsed = JSON.parse(data);

  console.log('\n=== User Profile ===\n');
  console.log(`User ID: ${parsed.userId}`);
  console.log(`Created: ${new Date(parsed.createdAt).toLocaleString('zh-CN')}`);
  console.log(`Updated: ${new Date(parsed.updatedAt).toLocaleString('zh-CN')}`);

  console.log('\n--- Preferences ---');
  console.log(`Default Language: ${parsed.preferences.programming.defaultLanguage}`);
  console.log(`Code Style: ${parsed.preferences.programming.codeStyle}`);
  console.log(`Interaction Verbosity: ${parsed.preferences.interaction.verbosity}`);
  console.log(`Time Zone: ${parsed.preferences.interaction.timeZone}`);

  console.log('\n--- Statistics ---');
  console.log(`Total Interactions: ${parsed.statistics.totalInteractions}`);
  console.log(`Tasks Completed: ${parsed.statistics.totalTasksCompleted}`);
  console.log(`Success Rate: ${(parsed.statistics.successRate * 100).toFixed(1)}%`);
  if (parsed.statistics.averageExecutionTime > 0) {
    console.log(`Avg Execution Time: ${parsed.statistics.averageExecutionTime.toFixed(2)}ms`);
  }
}

/**
 * Show user preferences
 */
async function cmdUserPreferences(profile: any, args: string[]): Promise<void> {
  const prefs = profile.getPreferences();

  if (args.length > 0 && args[0] === 'set') {
    // Set preference: user preferences set <key> <value>
    const key = args[1];
    const value = args[2];
    if (!key || !value) {
      console.error('Error: Key and value required');
      console.log('Usage: pnpm cli user preferences set <key> <value>');
      return;
    }
    const updates: any = {};
    updates[key] = value;
    await profile.updatePreferences(updates);
    console.log(`✓ Preference updated: ${key} = ${value}`);
    return;
  }

  console.log('\n=== User Preferences ===\n');
  console.log(JSON.stringify(prefs, null, 2));
}

/**
 * Show user history
 */
async function cmdUserHistory(profile: any, limit: number): Promise<void> {
  const history = profile.getHistory(limit);

  console.log(`\n=== Recent History (last ${history.length}) ===\n`);

  if (history.length === 0) {
    console.log('No history yet.\n');
    return;
  }

  for (const entry of history.reverse()) {
    const timestamp = new Date(entry.timestamp).toLocaleString('zh-CN');
    const status = entry.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${status} [${timestamp}]`);
    console.log(`  Agent: ${entry.agentUsed}`);
    console.log(`  Input: ${entry.userInput.substring(0, 60)}...`);
    console.log(`  Skills: ${entry.skillsUsed.join(', ') || 'none'}`);
    console.log(`  Duration: ${entry.executionTime}ms`);
    console.log();
  }
}

/**
 * Show user statistics
 */
async function cmdUserStats(profile: any): Promise<void> {
  const stats = profile.getStatistics();

  console.log('\n=== User Statistics ===\n');
  console.log(`Total Interactions: ${stats.totalInteractions}`);
  console.log(`Tasks Completed: ${stats.totalTasksCompleted}`);
  console.log(`Success Rate: ${(stats.successRate * 100).toFixed(1)}%`);
  console.log(`Avg Execution Time: ${stats.averageExecutionTime.toFixed(2)}ms`);

  console.log('\n--- Most Used Agents ---');
  const agents = Object.entries(stats.mostUsedAgents)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 5);
  for (const [agent, count] of agents) {
    console.log(`  ${agent}: ${count}`);
  }

  console.log('\n--- Most Used Skills ---');
  const skills = Object.entries(stats.mostUsedSkills)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 5);
  for (const [skill, count] of skills) {
    console.log(`  ${skill}: ${count}`);
  }

  console.log('\n--- Recommendations ---');
  const recommendedAgents = profile.getRecommendedAgents();
  const recommendedSkills = profile.getRecommendedSkills();
  console.log(`  Recommended Agents: ${recommendedAgents.join(', ') || 'none'}`);
  console.log(`  Recommended Skills: ${recommendedSkills.join(', ') || 'none'}`);
  console.log();
}

/**
 * Update user preferences
 */
async function cmdUserUpdate(profile: any, args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error('Error: Key and value required');
    console.log('Usage: pnpm cli user update <key> <value>');
    console.log('Examples:');
    console.log('  pnpm cli user update programming.defaultLanguage Python');
    console.log('  pnpm cli user update interaction.verbosity verbose');
    return;
  }

  const key = args[0];
  const value = args[1];
  const updates: any = {};
  updates[key] = value;

  await profile.updatePreferences(updates);
  console.log(`✓ Preference updated: ${key} = ${value}`);
}

/**
 * Schedule management command
 * Usage: schedule <cron|once|delay|list|cancel|pause|resume|executions> ...
 */
async function cmdSchedule(args: string[], options: Record<string, any>): Promise<void> {
  const { getTaskScheduler } = await import('./scheduler/Scheduler.js');
  const scheduler = getTaskScheduler();
  await scheduler.initialize();

  const subcommand = args[0] || 'list';

  switch (subcommand) {
    case 'cron':
      await cmdScheduleCron(scheduler, args.slice(1), options);
      break;

    case 'once':
      await cmdScheduleOnce(scheduler, args.slice(1), options);
      break;

    case 'delay':
      await cmdScheduleDelay(scheduler, args.slice(1), options);
      break;

    case 'list':
      await cmdScheduleList(scheduler);
      break;

    case 'cancel':
      if (!args[1]) {
        console.error('Error: Task ID required');
        console.log('Usage: pnpm cli schedule cancel <taskId>');
        return;
      }
      await cmdScheduleCancel(scheduler, args[1]);
      break;

    case 'pause':
      if (!args[1]) {
        console.error('Error: Task ID required');
        console.log('Usage: pnpm cli schedule pause <taskId>');
        return;
      }
      await cmdSchedulePause(scheduler, args[1]);
      break;

    case 'resume':
      if (!args[1]) {
        console.error('Error: Task ID required');
        console.log('Usage: pnpm cli schedule resume <taskId>');
        return;
      }
      await cmdScheduleResume(scheduler, args[1]);
      break;

    case 'executions':
    case 'history':
      if (!args[1]) {
        console.error('Error: Task ID required');
        console.log('Usage: pnpm cli schedule executions <taskId> [limit]');
        return;
      }
      await cmdScheduleExecutions(scheduler, args[1], parseInt(args[2] || '10'));
      break;

    case 'info':
      if (!args[1]) {
        console.error('Error: Task ID required');
        console.log('Usage: pnpm cli schedule info <taskId>');
        return;
      }
      await cmdScheduleInfo(scheduler, args[1]);
      break;

    default:
      console.error(`Error: Unknown subcommand "${subcommand}"`);
      console.log('Available subcommands: cron, once, delay, list, cancel, pause, resume, executions, info');
      break;
  }
}

/**
 * Create a cron scheduled task
 */
async function cmdScheduleCron(scheduler: any, args: string[], options: Record<string, any>): Promise<void> {
  const expression = args[0];
  const userInput = args.slice(1).join(' ');

  if (!expression || !userInput) {
    console.error('Error: Cron expression and task description required');
    console.log('Usage: pnpm cli schedule cron "<expression>" <task description>');
    console.log('Examples:');
    console.log('  pnpm cli schedule cron "0 9 * * *" "Run daily report"');
    console.log('  pnpm cli schedule cron "*/5 * * * *" "Check status every 5 minutes"');
    return;
  }

  const task = {
    id: `cron-${Date.now()}`,
    name: options.name || `Cron ${expression}`,
    description: userInput,
    type: 'cron' as const,
    schedule: {
      cron: {
        expression,
        timezone: options.timezone || 'Asia/Shanghai',
      },
    },
    task: {
      userInput,
      userId: options.user || 'default',
    },
    status: 'active' as const,
    executions: [],
    createdAt: new Date(),
  };

  const taskId = await scheduler.schedule(task);
  console.log(`✓ Cron task scheduled: ${taskId}`);
  console.log(`  Expression: ${expression}`);
  console.log(`  Task: ${userInput}`);
}

/**
 * Create a one-time scheduled task
 */
async function cmdScheduleOnce(scheduler: any, args: string[], options: Record<string, any>): Promise<void> {
  const datetimeStr = args[0];
  const userInput = args.slice(1).join(' ');

  if (!datetimeStr || !userInput) {
    console.error('Error: Date/time and task description required');
    console.log('Usage: pnpm cli schedule once "<YYYY-MM-DD HH:MM>" <task description>');
    console.log('Example:');
    console.log('  pnpm cli schedule once "2024-12-25 09:00" "Run Christmas report"');
    return;
  }

  const executeAt = new Date(datetimeStr);
  if (isNaN(executeAt.getTime())) {
    console.error('Error: Invalid date format. Use YYYY-MM-DD HH:MM');
    return;
  }

  const task = {
    id: `once-${Date.now()}`,
    name: options.name || `Once ${datetimeStr}`,
    description: userInput,
    type: 'once' as const,
    schedule: {
      once: { executeAt },
    },
    task: {
      userInput,
      userId: options.user || 'default',
    },
    status: 'active' as const,
    executions: [],
    createdAt: new Date(),
  };

  const taskId = await scheduler.schedule(task);
  console.log(`✓ One-time task scheduled: ${taskId}`);
  console.log(`  Execute at: ${executeAt.toLocaleString('zh-CN')}`);
  console.log(`  Task: ${userInput}`);
}

/**
 * Create a delayed task
 */
async function cmdScheduleDelay(scheduler: any, args: string[], options: Record<string, any>): Promise<void> {
  const delayStr = args[0];
  const userInput = args.slice(1).join(' ');

  if (!delayStr || !userInput) {
    console.error('Error: Delay and task description required');
    console.log('Usage: pnpm cli schedule delay <milliseconds> <task description>');
    console.log('Examples:');
    console.log('  pnpm cli schedule delay 60000 "Check status in 1 minute"');
    console.log('  pnpm cli schedule delay 3600000 "Run hourly report"');
    return;
  }

  const delayMs = parseInt(delayStr);
  if (isNaN(delayMs) || delayMs <= 0) {
    console.error('Error: Invalid delay. Use positive number in milliseconds');
    return;
  }

  const task = {
    id: `delay-${Date.now()}`,
    name: options.name || `Delay ${delayMs}ms`,
    description: userInput,
    type: 'delay' as const,
    schedule: {
      delay: { delayMs },
    },
    task: {
      userInput,
      userId: options.user || 'default',
    },
    status: 'active' as const,
    executions: [],
    createdAt: new Date(),
  };

  const taskId = await scheduler.schedule(task);
  console.log(`✓ Delayed task scheduled: ${taskId}`);
  console.log(`  Delay: ${delayMs}ms (${(delayMs / 1000).toFixed(1)}s)`);
  console.log(`  Task: ${userInput}`);
}

/**
 * List all scheduled tasks
 */
async function cmdScheduleList(scheduler: any): Promise<void> {
  const tasks = await scheduler.listTasks();

  console.log('\n=== Scheduled Tasks ===\n');

  if (tasks.length === 0) {
    console.log('No scheduled tasks.\n');
    return;
  }

  for (const task of tasks) {
    const statusEmojis: Record<string, string> = {
      active: '\x1b[32m●\x1b[0m',
      paused: '\x1b[33m⏸\x1b[0m',
      completed: '\x1b[36m✓\x1b[0m',
      pending: '\x1b[34m○\x1b[0m',
      failed: '\x1b[31m✗\x1b[0m',
    };
    const statusEmoji = statusEmojis[task.status] || '○';

    console.log(`${statusEmoji} ${task.id} - ${task.name}`);
    console.log(`   Type: ${task.type}`);
    console.log(`   Status: ${task.status}`);
    console.log(`   Task: ${task.task.userInput.substring(0, 50)}...`);

    if (task.nextRunAt) {
      console.log(`   Next run: ${new Date(task.nextRunAt).toLocaleString('zh-CN')}`);
    }
    if (task.lastRunAt) {
      console.log(`   Last run: ${new Date(task.lastRunAt).toLocaleString('zh-CN')}`);
    }

    console.log(`   Created: ${new Date(task.createdAt).toLocaleString('zh-CN')}`);
    console.log(`   Executions: ${task.executions.length}`);
    console.log();
  }
}

/**
 * Cancel a scheduled task
 */
async function cmdScheduleCancel(scheduler: any, taskId: string): Promise<void> {
  const cancelled = await scheduler.cancel(taskId);
  if (cancelled) {
    console.log(`✓ Task cancelled: ${taskId}`);
  } else {
    console.error(`✗ Task not found: ${taskId}`);
  }
}

/**
 * Pause a scheduled task
 */
async function cmdSchedulePause(scheduler: any, taskId: string): Promise<void> {
  const paused = await scheduler.pause(taskId);
  if (paused) {
    console.log(`✓ Task paused: ${taskId}`);
  } else {
    console.error(`✗ Failed to pause task: ${taskId}`);
  }
}

/**
 * Resume a paused task
 */
async function cmdScheduleResume(scheduler: any, taskId: string): Promise<void> {
  const resumed = await scheduler.resume(taskId);
  if (resumed) {
    console.log(`✓ Task resumed: ${taskId}`);
  } else {
    console.error(`✗ Failed to resume task: ${taskId}`);
  }
}

/**
 * Show execution history for a task
 */
async function cmdScheduleExecutions(scheduler: any, taskId: string, limit: number): Promise<void> {
  const executions = await scheduler.getExecutions(taskId, limit);
  const task = await scheduler.getTask(taskId);

  console.log(`\n=== Execution History: ${taskId} ===\n`);

  if (!task) {
    console.error(`Task not found: ${taskId}\n`);
    return;
  }

  console.log(`Task: ${task.task.userInput.substring(0, 60)}...\n`);

  if (executions.length === 0) {
    console.log('No executions yet.\n');
    return;
  }

  for (const exec of executions) {
    const statusEmojis: Record<string, string> = {
      success: '\x1b[32m✓\x1b[0m',
      failed: '\x1b[31m✗\x1b[0m',
      running: '\x1b[33m●\x1b[0m',
    };
    const statusEmoji = statusEmojis[exec.status] || '?';

    console.log(`${statusEmoji} ${exec.runId}`);
    console.log(`   Started: ${new Date(exec.startedAt).toLocaleString('zh-CN')}`);
    if (exec.completedAt) {
      const duration = exec.completedAt.getTime() - exec.startedAt.getTime();
      console.log(`   Completed: ${new Date(exec.completedAt).toLocaleString('zh-CN')} (${duration}ms)`);
    }
    console.log(`   Status: ${exec.status}`);
    if (exec.error) {
      console.log(`   Error: ${exec.error}`);
    }
    console.log();
  }
}

/**
 * Show detailed info for a task
 */
async function cmdScheduleInfo(scheduler: any, taskId: string): Promise<void> {
  const task = await scheduler.getTask(taskId);

  if (!task) {
    console.error(`Task not found: ${taskId}\n`);
    return;
  }

  console.log(`\n=== Task: ${taskId} ===\n`);
  console.log(`Name: ${task.name}`);
  console.log(`Description: ${task.description || 'N/A'}`);
  console.log(`Type: ${task.type}`);
  console.log(`Status: ${task.status}`);
  console.log(`\n--- Schedule ---`);
  console.log(JSON.stringify(task.schedule, null, 2));
  console.log(`\n--- Task Content ---`);
  console.log(`User Input: ${task.task.userInput}`);
  console.log(`User ID: ${task.task.userId || 'N/A'}`);
  console.log(`\n--- Metadata ---`);
  console.log(`Created: ${new Date(task.createdAt).toLocaleString('zh-CN')}`);
  if (task.nextRunAt) {
    console.log(`Next Run: ${new Date(task.nextRunAt).toLocaleString('zh-CN')}`);
  }
  if (task.lastRunAt) {
    console.log(`Last Run: ${new Date(task.lastRunAt).toLocaleString('zh-CN')}`);
  }
  if (task.completedAt) {
    console.log(`Completed: ${new Date(task.completedAt).toLocaleString('zh-CN')}`);
  }
  console.log(`Total Executions: ${task.executions.length}`);
  console.log();
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
 * Start API server
 */
async function cmdServe(_args: string[], options: Record<string, any>): Promise<void> {
  const { getAPIServer } = await import('./api/server.js');

  const config = {
    host: options.host || process.env.API_HOST || '0.0.0.0',
    port: parseInt(options.port || process.env.API_PORT || '3000'),
    logger: true,
  };

  const server = getAPIServer(config);
  await server.initialize();

  console.log('\n=== NexusAgent-Cluster API Server ===');
  console.log(`Server: http://${config.host}:${config.port}`);
  console.log(`Health: http://${config.host}:${config.port}/health`);
  console.log(`WebSocket: ws://${config.host}:${config.port}/ws`);
  console.log('\nAPI Endpoints:');
  console.log(`  POST   /api/v1/tasks/submit      - Submit a task`);
  console.log(`  GET    /api/v1/tasks/:taskId       - Get task status`);
  console.log(`  DELETE /api/v1/tasks/:taskId       - Cancel a task`);
  console.log(`  GET    /api/v1/sessions/:id/tasks - Get session tasks`);
  console.log(`  GET    /api/v1/skills            - List all skills`);
  console.log(`  GET    /api/v1/skills/:name       - Get skill info`);
  console.log(`  GET    /api/v1/agents            - List active agents`);
  console.log(`  WS     /ws                       - WebSocket connection`);
  console.log('\nPress Ctrl+C to stop\n');

  await server.start();
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
 * Start Gateway server (WebSocket gateway inspired by clawdbot)
 */
async function cmdGateway(_args: string[], options: Record<string, any>): Promise<void> {
  const { getGatewayServer } = await import('./gateway/GatewayServer.js');

  const config = {
    host: options.host || process.env.GATEWAY_HOST || '127.0.0.1',
    port: parseInt(options.port || process.env.GATEWAY_PORT || '18789'),
  };

  const gateway = getGatewayServer(config);
  await gateway.start();

  console.log('\n=== NexusAgent-Cluster Gateway Server ===');
  console.log(`WebSocket: ws://${config.host}:${config.port}/ws`);
  console.log('\nGateway Features:');
  console.log(`  Real-time WebSocket communication`);
  console.log(`  Streaming response support`);
  console.log(`  Multi-platform session management`);
  console.log(`  Health monitoring`);
  console.log('\nWebSocket Event Types:');
  console.log(`  lifecycle - Run lifecycle events (start/end)`);
  console.log(`  assistant - Streaming text output`);
  console.log(`  chat      - Chat completion events`);
  console.log(`  tick      - Periodic keep-alive (30s)`);
  console.log(`  health    - Health status (60s)`);
  console.log('\nMessage Format:');
  console.log(`  {"type": "chat", "content": "Your message", "userId": "user123"}`);
  console.log('\nPress Ctrl+C to stop\n');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down gateway...');
    await gateway.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n\nShutting down gateway...');
    await gateway.stop();
    process.exit(0);
  });

  // Keep process running
  await new Promise(() => {});
}

/**
 * Feedback management command
 * Usage: feedback <stats|submit|list>
 */
async function cmdFeedback(args: string[], options: Record<string, any>): Promise<void> {
  const { getOrchestrator } = await import('./orchestrator/Orchestrator.js');
  const orchestrator = getOrchestrator();
  await orchestrator.initialize();

  const subcommand = args[0] || 'stats';

  switch (subcommand) {
    case 'stats':
      await cmdFeedbackStats(orchestrator);
      break;

    case 'submit':
      await cmdFeedbackSubmit(orchestrator, args.slice(1), options);
      break;

    case 'list':
      await cmdFeedbackList(orchestrator, args.slice(1));
      break;

    default:
      console.error('\nError: Unknown subcommand');
      console.log('Usage: pnpm cli feedback <stats|submit|list>');
      console.log('  pnpm cli feedback stats              - Show feedback statistics');
      console.log('  pnpm cli feedback submit <sessionId>  - Submit feedback for a session');
      console.log('  pnpm cli feedback list <agentType>     - List feedback for an agent');
      process.exit(1);
  }
}

/**
 * Show feedback statistics
 */
async function cmdFeedbackStats(orchestrator: any): Promise<void> {
  const feedbackCollector = orchestrator.getFeedbackCollector();
  const stats = await feedbackCollector.getStatistics();

  console.log('\n=== Feedback Statistics ===\n');

  console.log('Overview:');
  console.log(`  Total Feedbacks: ${stats.totalFeedbacks}`);
  console.log(`  Average Rating: ${stats.averageRating.toFixed(2)}/5`);
  console.log(`  Success Rate: ${(stats.successRate * 100).toFixed(1)}%`);

  if (Object.keys(stats.agentPerformance).length > 0) {
    console.log('\nAgent Performance:');
    for (const [agentType, perf] of Object.entries(stats.agentPerformance)) {
      const perfData = perf as { totalTasks: number; averageRating: number; averageExecutionTime: number };
      console.log(`  ${agentType}:`);
      console.log(`    Tasks: ${perfData.totalTasks}`);
      console.log(`    Avg Rating: ${perfData.averageRating.toFixed(2)}/5`);
      console.log(`    Avg Time: ${perfData.averageExecutionTime.toFixed(0)}ms`);
    }
  }

  if (stats.commonIssues.length > 0) {
    console.log('\nCommon Issues:');
    for (const issue of stats.commonIssues) {
      console.log(`  - ${issue}`);
    }
  }

  console.log();
}

/**
 * Submit feedback for a session
 */
async function cmdFeedbackSubmit(orchestrator: any, args: string[], options: Record<string, any>): Promise<void> {
  const sessionId = args[0];

  if (!sessionId) {
    console.error('\nError: Session ID required');
    console.log('Usage: pnpm cli feedback submit <sessionId> [--rating 1-5] [--satisfied] [--issues "issue1,issue2"] [--suggestions "suggestion1,suggestion2"]');
    process.exit(1);
  }

  const feedback: any = {};

  if (options.rating) {
    const rating = parseInt(options.rating);
    if (rating < 1 || rating > 5) {
      console.error('Error: Rating must be between 1 and 5');
      process.exit(1);
    }
    feedback.rating = rating;
  }

  if (options.satisfied !== undefined) {
    feedback.satisfied = options.satisfied === 'true' || options.satisfied === true;
  }

  if (options.issues) {
    feedback.issues = options.issues.split(',').map((s: string) => s.trim());
  }

  if (options.suggestions) {
    feedback.suggestions = options.suggestions.split(',').map((s: string) => s.trim());
  }

  // Interactive mode if no feedback provided
  if (Object.keys(feedback).length === 0) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const rating = await new Promise<string>((resolve) => {
        rl.question('Rating (1-5): ', resolve);
      });
      if (rating) feedback.rating = parseInt(rating);

      const satisfied = await new Promise<string>((resolve) => {
        rl.question('Satisfied? (yes/no): ', resolve);
      });
      if (satisfied) feedback.satisfied = satisfied.toLowerCase() === 'yes';

      const issues = await new Promise<string>((resolve) => {
        rl.question('Issues (comma-separated, optional): ', resolve);
      });
      if (issues) feedback.issues = issues.split(',').map(s => s.trim());

      const suggestions = await new Promise<string>((resolve) => {
        rl.question('Suggestions (comma-separated, optional): ', resolve);
      });
      if (suggestions) feedback.suggestions = suggestions.split(',').map(s => s.trim());

      rl.close();
    } catch (error: any) {
      rl.close();
      throw error;
    }
  }

  console.log(`\nSubmitting feedback for session: ${sessionId}`);
  const result = await orchestrator.submitFeedback(sessionId, feedback);

  if (result.success) {
    console.log(`✓ ${result.message}`);
  } else {
    console.error(`✗ ${result.error}`);
    process.exit(1);
  }
}

/**
 * List feedback for an agent
 */
async function cmdFeedbackList(orchestrator: any, args: string[]): Promise<void> {
  const agentType = args[0];

  if (!agentType) {
    console.error('\nError: Agent type required');
    console.log('Usage: pnpm cli feedback list <agentType> [--limit 50]');
    console.log('\nAvailable agent types:');
    console.log('  CodeAgent, DataAgent, AnalysisAgent, AutomationAgent, GenericAgent');
    process.exit(1);
  }

  const feedbackCollector = orchestrator.getFeedbackCollector();
  const limit = parseInt(args[1] || '50');
  const feedbacks = await feedbackCollector.getFeedbackForAgent(agentType, limit);

  console.log(`\n=== Feedback for ${agentType} (${feedbacks.length} recent) ===\n`);

  for (const feedback of feedbacks.slice(0, 20)) {
    console.log(`\n[${new Date(feedback.timestamp).toLocaleString()}] ${feedback.sessionId.substring(0, 8)}...`);
    console.log(`  Agent: ${feedback.agentType}`);
    console.log(`  Success: ${feedback.success ? '✅' : '❌'}`);
    console.log(`  Time: ${feedback.executionTime}ms`);
    if (feedback.rating) {
      console.log(`  Rating: ${feedback.rating}/5`);
    }
    if (feedback.issues && feedback.issues.length > 0) {
      console.log(`  Issues: ${feedback.issues.join(', ')}`);
    }
  }

  console.log(`\nShowing 20 of ${feedbacks.length} feedbacks\n`);
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
  skills install <src>   Install a skill from npm/git/local/mcp
  skills remove <name>   Remove an installed skill
  skills update <name>   Update a skill from git
  skill info <name>      Show detailed skill information
  skill enable <name>    Enable a skill
  skill disable <name>   Disable a skill
  skill test <name>      Test a skill execution
  user profile           Show user profile
  user preferences       Show/update user preferences
  user history           Show user interaction history
  user stats             Show user statistics
  schedule cron          Create a cron scheduled task
  schedule once          Create a one-time scheduled task
  schedule delay         Create a delayed task
  schedule list          List all scheduled tasks
  schedule cancel        Cancel a scheduled task
  schedule pause         Pause a scheduled task
  schedule resume        Resume a paused task
  schedule executions    Show execution history
  test                   Run tests
  clean                  Clean Redis data
  serve                  Start API server
  gateway                Start WebSocket gateway (clawdbot-style)
  feedback stats         Show feedback statistics
  feedback submit        Submit user feedback for a session
  feedback list          List feedback by agent type
  help                   Show this help message

Examples:
  pnpm cli chat                 Start interactive mode
  pnpm cli run "创建一个RESTful API"
  pnpm cli status
  pnpm cli skills list
  pnpm cli skills search "code"
  pnpm cli skills install npm @nexus-skills/github
  pnpm cli skills install git https://github.com/user/skill.git
  pnpm cli skills install local ./my-skill
  pnpm cli skills install mcp my-server --url ws://localhost:3000
  pnpm cli skills remove github
  pnpm cli skills update github
  pnpm cli skill info code-generation
  pnpm cli skill test file-ops
  pnpm cli user profile          Show user profile
  pnpm cli user stats            Show user statistics
  pnpm cli schedule cron "0 9 * * *" "Run daily report"
  pnpm cli schedule delay 60000 "Check in 1 minute"
  pnpm cli schedule list
  pnpm cli serve                 Start API server
  pnpm cli gateway               Start WebSocket gateway
  pnpm cli feedback stats        Show feedback statistics
  pnpm cli feedback submit <sessionId> --rating 5 --satisfied
  pnpm cli feedback list CodeAgent

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

  skills install:
    --force           Overwrite existing skill
    --name <name>     Custom skill name (for git/local)
    --url <url>       MCP server URL

  skill test:
    --params <json>   Test with custom parameters (JSON string)

  user commands:
    --user, -u <id>   User ID (default: "default")

  schedule commands:
    --name <name>     Task name
    --user <id>       User ID (default: "default")
    --timezone <tz>   Timezone (default: "Asia/Shanghai")

  serve commands:
    --host <address>  Host to bind to (default: 0.0.0.0)
    --port <number>   Port to listen on (default: 3000)

  feedback commands:
    --rating <1-5>    Rating for the task (1-5)
    --satisfied       Whether satisfied with the result
    --issues <text>   Issues encountered (comma-separated)
    --suggestions <text>  Suggestions for improvement (comma-separated)
    --limit <num>     Limit number of feedback results (default: 50)

Environment:
  ZHIPU_API_KEY       Zhipu AI API key
  DEEPSEEK_API_KEY    DeepSeek API key
  OPENAI_API_KEY      OpenAI API key
  REDIS_URL           Redis connection URL
  LOG_LEVEL           Logging level (debug, info, warn, error)
  API_HOST            API server host (default: 0.0.0.0)
  API_PORT            API server port (default: 3000)
`);
}

// Run CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
