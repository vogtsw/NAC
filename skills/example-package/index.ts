/**
 * Example Skill Package
 * Demonstrates how to create a skill package with multiple skills
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../../src/skills/types.js';

/**
 * Text Processing Skill
 * Provides text manipulation and analysis capabilities
 */
export const TextProcessingSkill: Skill = {
  name: 'text-processing',
  version: '1.0.0',
  description: 'Process and manipulate text content',
  category: SkillCategory.ANALYSIS,
  enabled: true,
  builtin: false,

  parameters: {
    required: ['text', 'operation'],
    optional: ['options'],
    schema: {
      text: 'string - The text to process',
      operation: 'string - Operation to perform: uppercase, lowercase, reverse, wordcount, sentiment',
      options: 'object - Additional options for the operation',
    },
  },

  validate(params: any): boolean {
    return !!params.text && !!params.operation;
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { text, operation, options = {} } = params;

    try {
      context.logger?.info({ operation, textLength: text.length }, 'Processing text');

      let result: any;

      switch (operation.toLowerCase()) {
        case 'uppercase':
          result = text.toUpperCase();
          break;
        case 'lowercase':
          result = text.toLowerCase();
          break;
        case 'reverse':
          result = text.split('').reverse().join('');
          break;
        case 'wordcount':
          result = {
            words: text.split(/\s+/).filter(w => w.length > 0).length,
            characters: text.length,
            charactersNoSpaces: text.replace(/\s/g, '').length,
            lines: text.split('\n').length,
          };
          break;
        case 'sentiment':
          // Simple mock sentiment analysis
          const positive = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'happy'];
          const negative = ['bad', 'terrible', 'awful', 'horrible', 'sad', 'angry'];
          const lowerText = text.toLowerCase();
          const score = positive.filter(w => lowerText.includes(w)).length -
                         negative.filter(w => lowerText.includes(w)).length;
          result = {
            score: Math.max(-1, Math.min(1, score / 5)),
            sentiment: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral',
          };
          break;
        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}`,
          };
      }

      return {
        success: true,
        result: {
          operation,
          original: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
          processed: result,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

/**
 * Email Skill
 * Send email notifications
 */
export const EmailSkill: Skill = {
  name: 'email',
  version: '1.0.0',
  description: 'Send email notifications',
  category: SkillCategory.AUTOMATION,
  enabled: true,
  builtin: false,

  parameters: {
    required: ['to', 'subject', 'body'],
    optional: ['from', 'cc', 'bcc', 'html'],
    schema: {
      to: 'string|array - Recipient email address(es)',
      subject: 'string - Email subject',
      body: 'string - Email body content',
      from: 'string - Sender email address',
      cc: 'string|array - CC recipients',
      bcc: 'string|array - BCC recipients',
      html: 'boolean - Whether body is HTML (default: false)',
    },
  },

  validate(params: any): boolean {
    return !!params.to && !!params.subject && !!params.body;
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { to, subject, body, from, cc, bcc, html = false } = params;

    try {
      context.logger?.info({ to, subject }, 'Sending email');

      // In a real implementation, this would use an SMTP client or email API
      // For demonstration, we'll just log the email details

      const emailData = {
        to: Array.isArray(to) ? to : [to],
        subject,
        body: body.substring(0, 200) + (body.length > 200 ? '...' : ''),
        from: from || 'noreply@nexusagent.local',
        cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
        bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
        html,
        sentAt: new Date().toISOString(),
      };

      context.logger?.info({ emailData }, 'Email prepared (not actually sent in demo mode)');

      return {
        success: true,
        result: {
          messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          ...emailData,
          note: 'Email prepared but not sent (demo mode)',
        },
        metadata: {
          recipients: emailData.to.length,
          html,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
};
