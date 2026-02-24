/**
 * Skills Routes
 * Skill management endpoints
 */

import { FastifyInstance } from 'fastify';
import { getLogger } from '../../monitoring/logger.js';
import { getSkillManager } from '../../skills/SkillManager.js';
import { SkillCategory } from '../../skills/types.js';

const logger = getLogger('SkillsRoutes');

export async function skillRoutes(fastify: FastifyInstance) {
  // List all skills
  fastify.get('/', async (request, reply) => {
    const { category, enabled_only } = request.query as any;

    const skillManager = getSkillManager();
    let skills = skillManager.listSkills();

    if (category) {
      skills = skills.filter((s) => s.category === category);
    }

    if (enabled_only === 'true') {
      skills = skills.filter((s) => s.enabled);
    }

    const builtin = skills.filter((s) => s.builtin).length;
    const custom = skills.length - builtin;

    return {
      skills,
      total: skills.length,
      builtin,
      custom,
    };
  });

  // Get skill by ID
  fastify.get('/:skill_id', async (request, reply) => {
    const { skill_id } = request.params as { skill_id: string };

    const skillManager = getSkillManager();
    const skill = skillManager.getSkill(skill_id);

    if (!skill) {
      return reply.status(404).send({
        error: 'Skill not found',
        skill_id,
      });
    }

    return {
      skill_id: skill.name,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      version: skill.version,
      enabled: skill.enabled,
      builtin: skill.builtin || false,
      parameters: skill.parameters,
    };
  });

  // Execute skill
  fastify.post('/execute', async (request, reply) => {
    const { skill_id, parameters, context } = request.body as any;

    if (!skill_id) {
      return reply.status(400).send({
        error: 'Missing required field: skill_id',
      });
    }

    const skillManager = getSkillManager();
    const startTime = Date.now();

    const result = await skillManager.executeSkill(skill_id, parameters || {}, context || {});

    const duration = Date.now() - startTime;

    return {
      skill_id,
      success: result.success,
      result: result.result,
      error: result.error,
      execution_time: duration,
    };
  });

  // List skill categories
  fastify.get('/categories', async (request, reply) => {
    return {
      categories: Object.values(SkillCategory).map((cat) => ({
        value: cat,
        label: cat.charAt(0).toUpperCase() + cat.slice(1),
      })),
    };
  });

  // Enable skill
  fastify.post('/:skill_id/enable', async (request, reply) => {
    const { skill_id } = request.params as { skill_id: string };

    const skillManager = getSkillManager();
    const success = skillManager.enableSkill(skill_id);

    if (!success) {
      return reply.status(404).send({
        error: 'Skill not found',
        skill_id,
      });
    }

    logger.info({ skill_id }, 'Skill enabled');

    return {
      message: `Skill ${skill_id} enabled successfully`,
    };
  });

  // Disable skill
  fastify.post('/:skill_id/disable', async (request, reply) => {
    const { skill_id } = request.params as { skill_id: string };

    const skillManager = getSkillManager();
    const success = skillManager.disableSkill(skill_id);

    if (!success) {
      return reply.status(404).send({
        error: 'Skill not found',
        skill_id,
      });
    }

    logger.info({ skill_id }, 'Skill disabled');

    return {
      message: `Skill ${skill_id} disabled successfully`,
    };
  });
}
