/**
 * Prompt templates used by intent parsing, DAG planning, and built-in skills.
 */

export const IntentAnalysisPrompt = {
  format: (userInput: string) => `You are an intent parser for a multi-agent automation system.

User input:
${userInput}

Classify the request and return only JSON with this schema:
{
  "intent_type": "conversation|code|data|automation|analysis|deployment|other",
  "primary_goal": "short goal description",
  "required_capabilities": ["capability names"],
  "complexity": "simple|medium|complex",
  "estimated_steps": 0,
  "constraints": [],
  "conversation_type": "greeting|thanks|farewell|chat|help"
}

Rules:
1. For greetings, thanks, farewell, casual chat, or help requests, use intent_type "conversation".
2. For search or information retrieval requests, use intent_type "automation" and include "web-search" and "information-retrieval".
3. For coding requests, use intent_type "code" and include capabilities such as "code_gen", "api_design", or "testing".
4. Always include the key "intent_type".`,
};

export const TaskPlanningPrompt = {
  format: (params: {
    intent: string;
    primaryGoal: string;
    capabilities: string;
    complexity: string;
    availableSkills?: string[];
  }) => {
    const skillsSection = params.availableSkills?.length
      ? `\nAvailable skills: ${params.availableSkills.join(', ')}\nOnly use values from this list in required_skills.`
      : '';

    return `You are a task planner for a DAG-based multi-agent runtime.

Intent: ${params.intent}
Primary goal: ${params.primaryGoal}
Required capabilities: ${params.capabilities}
Complexity: ${params.complexity}${skillsSection}

Return only JSON with this schema:
{
  "steps": [
    {
      "id": "step_1",
      "name": "step name",
      "description": "detailed step description",
      "agent_type": "GenericAgent|CodeAgent|DataAgent|AnalysisAgent|AutomationAgent",
      "required_skills": ["skill1"],
      "dependencies": [],
      "estimated_duration": 300
    }
  ],
  "parallelizable_groups": [["step_1"]],
  "critical_path": ["step_1"]
}

Planning constraints:
1. Keep the graph acyclic.
2. Use dependencies to represent hard ordering.
3. Prefer small, verifiable tasks.
4. Use one of these agent types exactly: GenericAgent, CodeAgent, DataAgent, AnalysisAgent, AutomationAgent.`;
  },
};

export const CodeReviewPrompt = {
  format: (code: string, language: string = 'typescript') => `You are a senior code reviewer.

Review this ${language} code:
\`\`\`${language}
${code}
\`\`\`

Return only JSON:
{
  "overall_score": 85,
  "issues": [
    {
      "severity": "high|medium|low",
      "category": "security|performance|style|logic",
      "line": 10,
      "description": "issue description",
      "suggestion": "fix suggestion"
    }
  ],
  "strengths": ["strength"],
  "improvement_suggestions": ["suggestion"]
}`,
};

export const CodeGenerationPrompt = {
  format: (params: {
    language: string;
    requirements: string;
    framework?: string;
  }) => `You are a senior software engineer.

Language: ${params.language}
${params.framework ? `Framework: ${params.framework}` : ''}

Requirements:
${params.requirements}

Generate clean, secure, maintainable code. Return only the code unless the user asks for explanation.`,
};

export const SystemPrompts = {
  CodeAgent: `You are a software development agent. Produce secure, maintainable, tested code and explain important tradeoffs briefly.`,
  DataAgent: `You are a data processing agent. Focus on correctness, data quality, efficient processing, and clear analysis outputs.`,
  AutomationAgent: `You are an automation agent. Design reliable workflows, handle errors explicitly, and preserve operation safety.`,
  AnalysisAgent: `You are an analysis agent. Reason from evidence, structure findings clearly, and produce actionable recommendations.`,
  GenericAgent: `You are a general task execution agent. Understand the request, plan briefly, execute reliably, and report concise results.`,
};
