/**
 * Task Routes
 * Handle task submission, status, and cancellation
 */

import { FastifyInstance } from 'fastify';
import { getLogger } from '../../monitoring/logger.js';
import { getOrchestrator } from '../../orchestrator/Orchestrator.js';
import { getBlackboard } from '../../state/Blackboard.js';
import { getEventBus, EventType } from '../../state/EventBus.js';

const logger = getLogger('TaskRoutes');

export async function taskRoutes(fastify: FastifyInstance) {
  // Submit task
  fastify.post('/submit', async (request, reply) => {
    const { user_input, session_id, priority = 5, context = {}, timeout = 600 } = request.body as any;

    if (!user_input) {
      return reply.status(400).send({
        error: 'Missing required field: user_input',
      });
    }

    const orchestrator = getOrchestrator();
    const eventBus = getEventBus();

    // Generate IDs
    const taskId = generateId();
    const sessionId = session_id || generateId();

    logger.info({ taskId, sessionId, userInput: user_input.substring(0, 100) }, 'Task submitted');

    // Execute asynchronously
    setImmediate(async () => {
      try {
        await orchestrator.processRequest({ sessionId, userInput, context });
      } catch (error: any) {
        logger.error({ taskId, sessionId, error: error.message }, 'Task execution failed');
        await eventBus.publish(EventType.ERROR_OCCURRED, { sessionId, taskId, error: error.message });
      }
    });

    reply.status(202).send({
      task_id: taskId,
      session_id: sessionId,
      status: 'pending',
      message: 'Task submitted successfully',
    });
  });

  // Get task status
  fastify.get('/:task_id', async (request, reply) => {
    const { task_id } = request.params as { task_id: string };

    const blackboard = getBlackboard();
    const state = await blackboard.getStateByTask(task_id);

    if (!state) {
      return reply.status(404).send({
        error: 'Task not found',
        task_id,
      });
    }

    const task = state.tasks.get(task_id);
    if (!task) {
      return reply.status(404).send({
        error: 'Task not found in session',
        task_id,
      });
    }

    return {
      task_id,
      session_id: state.sessionId,
      status: task.status,
      agent_type: task.agentType,
      result: task.result,
      error: task.error,
      started_at: task.startedAt?.toISOString(),
      completed_at: task.completedAt?.toISOString(),
    };
  });

  // Get session tasks
  fastify.get('/session/:session_id/tasks', async (request, reply) => {
    const { session_id } = request.params as { session_id: string };

    const blackboard = getBlackboard();
    const state = await blackboard.getState(session_id);

    if (!state) {
      return reply.status(404).send({
        error: 'Session not found',
        session_id,
      });
    }

    const tasks = Array.from(state.tasks.values()).map((task) => ({
      task_id: task.taskId,
      status: task.status,
      agent_type: task.agentType,
      started_at: task.startedAt?.toISOString(),
      completed_at: task.completedAt?.toISOString(),
      has_result: !!task.result,
      has_error: !!task.error,
    }));

    return {
      session_id,
      status: state.status,
      total_tasks: tasks.length,
      running: tasks.filter((t) => t.status === 'running').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      tasks,
    };
  });

  // Cancel task
  fastify.delete('/:task_id', async (request, reply) => {
    const { task_id } = request.params as { task_id: string };

    const orchestrator = getOrchestrator();
    const success = await orchestrator.cancelTask(task_id);

    if (!success) {
      return reply.status(404).send({
        error: 'Task not found or cannot be cancelled',
        task_id,
      });
    }

    logger.info({ task_id }, 'Task cancelled');

    return {
      message: 'Task cancelled successfully',
      task_id,
    };
  });

  // Get session info
  fastify.get('/session/:session_id', async (request, reply) => {
    const { session_id } = request.params as { session_id: string };

    const blackboard = getBlackboard();
    const state = await blackboard.getState(session_id);

    if (!state) {
      return reply.status(404).send({
        error: 'Session not found',
        session_id,
      });
    }

    return {
      session_id: state.sessionId,
      status: state.status,
      intent: state.intent,
      total_tasks: state.metrics.totalTasks,
      completed_tasks: state.metrics.completedTasks,
      critical_steps: state.metrics.criticalSteps,
      created_at: state.createdAt.toISOString(),
      updated_at: state.updatedAt.toISOString(),
    };
  });

  // Close session
  fastify.delete('/session/:session_id', async (request, reply) => {
    const { session_id } = request.params as { session_id: string };

    const blackboard = getBlackboard();
    await blackboard.deleteSession(session_id);

    logger.info({ session_id }, 'Session closed');

    return {
      message: 'Session closed successfully',
      session_id,
    };
  });
}

function generateId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
