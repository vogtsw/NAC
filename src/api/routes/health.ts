/**
 * Health Check Routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getLogger } from '../../monitoring/logger.js';
import { getOrchestrator } from '../../orchestrator/Orchestrator.js';
import { getBlackboard } from '../../state/Blackboard.js';
import { getSkillManager } from '../../skills/SkillManager.js';

const logger = getLogger('HealthRoutes');

export async function healthRoutes(fastify: FastifyInstance) {
  // Basic health check
  fastify.get('/', async (request, reply) => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      uptime: process.uptime(),
    };
  });

  // Detailed status
  fastify.get('/detailed', async (request, reply) => {
    const orchestrator = getOrchestrator();
    const blackboard = getBlackboard();
    const skillManager = getSkillManager();

    const components: Record<string, any> = {
      orchestrator: {
        status: 'healthy',
        initialized: true,
      },
      blackboard: {
        status: 'unknown',
      },
      skills: {
        status: 'healthy',
        totalSkills: skillManager.listSkills().length,
        enabledSkills: skillManager.listEnabledSkills().length,
      },
    };

    // Check Redis connection
    try {
      const sessions = await blackboard.getAllSessions();
      components.blackboard = {
        status: 'healthy',
        redisConnected: true,
        activeSessions: sessions.length,
      };
    } catch (error: any) {
      components.blackboard = {
        status: 'unhealthy',
        redisConnected: false,
        error: error.message,
      };
    }

    return {
      overallStatus: components.blackboard.status === 'healthy' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      components,
    };
  });

  // Readiness check
  fastify.get('/ready', async (request, reply) => {
    const blackboard = getBlackboard();

    try {
      const sessions = await blackboard.getAllSessions();
      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      reply.status(503);
      return {
        status: 'not ready',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  });

  // Liveness check
  fastify.get('/live', async (request, reply) => {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
    };
  });
}
