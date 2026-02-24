/**
 * CLI Tool
 * Command-line interface for NexusAgent-Cluster
 */

import 'dotenv/config';
import { getOrchestrator } from './orchestrator/Orchestrator.js';
import { getBlackboard } from './state/Blackboard.js';
import { getSkillManager } from './skills/SkillManager.js';
import { loadConfig } from './config/index.js';
import { getLogger } from './monitoring/logger.js';

const logger = getLogger('CLI');

interface CLIOptions {
  command: string;
  args: string[];
  options: Record<string, any>;
}

/**
 * Main CLI entry point
 */
async function main() {
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
    case 'serve':
    case 'start':
      await cmdServe(cli.options);
      break;

    case 'run':
      await cmdRun(cli.args, cli.options);
      break;

    case 'status':
      await cmdStatus();
      break;

    case 'test':
      await cmdTest(cli.args);
      break;

    case 'skills':
      await cmdSkills();
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
 * Start API server
 */
async function cmdServe(options: Record<string, any>): Promise<void> {
  const { startServer } = await import('./api/server.js');
  await startServer();
}

/**
 * Run a single task
 */
async function cmdRun(args: string[], options: Record<string, any>): Promise<void> {
  const [prompt] = args;

  if (!prompt) {
    console.error('Error: Missing prompt argument');
    console.log('Usage: npm run cli run "your prompt here"');
    process.exit(1);
  }

  const config = loadConfig();
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

  const skills = skillManager.listSkills();
  console.log(`\nTotal Skills: ${skills.length}`);
  console.log(`Enabled Skills: ${skills.filter((s) => s.enabled).length}`);
}

/**
 * List skills
 */
async function cmdSkills(): Promise<void> {
  const skillManager = getSkillManager();
  const skills = skillManager.listSkills();

  console.log('\n=== Available Skills ===\n');

  const byCategory: Record<string, any[]> = {};
  for (const skill of skills) {
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
      console.log(`  ${status} ${skill.name} ${builtin} - ${skill.description}`);
    }
  }
}

/**
 * Run tests
 */
async function cmdTest(args: string[]): Promise<void> {
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
  serve, start    Start the API server
  run <prompt>     Execute a single task
  status           Show system status
  skills           List available skills
  test             Run tests
  clean            Clean Redis data
  help             Show this help message

Examples:
  npm run cli serve
  npm run cli run "创建一个RESTful API"
  npm run cli status
  npm run cli skills

Environment:
  DEEPSEEK_API_KEY    DeepSeek API key
  DEEPSEEK_BASE_URL   DeepSeek API base URL
  REDIS_URL           Redis connection URL
`);
}

// Run CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
