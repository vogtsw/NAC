/**
 * Agent Routes
 * Agent management endpoints
 */

import { FastifyInstance } from 'fastify';
import { getLogger } from '../../monitoring/logger.js';
import { getOrchestrator } from '../../orchestrator/Orchestrator.js';

const logger = getLogger('AgentRoutes');

export async function agentRoutes(fastify: FastifyInstance) {
  // List all agents
  fastify.get('/', async (request, reply) => {
    const orchestrator = getOrchestrator();
    const agents = await orchestrator.getActiveAgents();

    const active = agents.filter((a) => a.status === 'busy').length;
    const idle = agents.filter((a) => a.status === 'idle').length;

    return {
      agents,
      total: agents.length,
      active,
      idle,
    };
  });

  // Get agent by ID
  fastify.get('/:agent_id', async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };

    const orchestrator = getOrchestrator();
    const agents = await orchestrator.getActiveAgents();
    const agent = agents.find((a) => a.agentId === agent_id);

    if (!agent) {
      return reply.status(404).send({
        error: 'Agent not found',
        agent_id,
      });
    }

    return agent;
  });

  // Get agent statistics
  fastify.get('/stats', async (request, reply) => {
    const orchestrator = getOrchestrator();
    const agents = await orchestrator.getActiveAgents();

    const total = agents.length;
    const active = agents.filter((a) => a.status === 'busy').length;
    const idle = agents.filter((a) => a.status === 'idle').length;

    const totalTasks = agents.reduce((sum, a) => sum + a.tasksCompleted, 0);
    const totalTime = agents.reduce((sum, a) => sum + a.totalExecutionTime, 0);
    const avgTime = totalTasks > 0 ? totalTime / totalTasks : 0;

    return {
      total_agents: total,
      active_agents: active,
      idle_agents: idle,
      total_tasks_completed: totalTasks,
      total_execution_time: totalTime,
      average_execution_time: avgTime,
    };
  });

  // List agent types
  fastify.get('/types', async (request, reply) => {
    return {
      agent_types: [
        { type: 'GenericAgent', description: 'General-purpose agent' },
        { type: 'CodeAgent', description: 'Code generation and review' },
        { type: 'DataAgent', description: 'Data processing and analysis' },
        { type: 'AutomationAgent', description: 'Automation and deployment' },
        { type: 'AnalysisAgent', description: 'Analysis and review' },
      ],
    };
  });

  // Recycle agent
  fastify.post('/:agent_id/recycle', async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };

    // Implement agent recycling logic
    logger.info({ agent_id }, 'Agent recycle requested');

    return {
      message: 'Agent recycle initiated',
      agent_id,
    };
  });
}
