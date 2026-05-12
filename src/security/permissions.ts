/**
 * Security Permissions
 * Defines all permission types for skill access control
 */

/**
 * Permission types for skill operations
 */
export enum Permission {
  // ==================== File Operations ====================
  /** Read file contents */
  FILE_READ = 'file:read',

  /** Write or create files */
  FILE_WRITE = 'file:write',

  /** Delete files */
  FILE_DELETE = 'file:delete',

  /** List directory contents */
  FILE_LIST = 'file:list',

  // ==================== Terminal Operations ====================
  /** Execute terminal commands */
  TERMINAL_EXEC = 'terminal:exec',

  /** Execute commands with elevated privileges */
  TERMINAL_EXEC_SUDO = 'terminal:sudo',

  // ==================== Network Operations ====================
  /** Perform web searches */
  WEB_SEARCH = 'web:search',

  /** Make API calls to external services */
  API_CALL = 'api:call',

  /** Access local network resources */
  NETWORK_ACCESS = 'network:access',

  // ==================== Code Operations ====================
  /** Generate code snippets */
  CODE_GENERATION = 'code:generation',

  /** Execute or run code */
  CODE_EXECUTION = 'code:execution',

  /** Review and analyze code */
  CODE_REVIEW = 'code:review',

  /** Refactor code */
  CODE_REFACTOR = 'code:refactor',

  // ==================== Data Operations ====================
  /** Read data from sources */
  DATA_READ = 'data:read',

  /** Write or modify data */
  DATA_WRITE = 'data:write',

  /** Delete data */
  DATA_DELETE = 'data:delete',

  /** Analyze data and generate insights */
  DATA_ANALYSIS = 'data:analysis',

  // ==================== Document Operations ====================
  /** Read documents */
  DOC_READ = 'doc:read',

  /** Write or create documents */
  DOC_WRITE = 'doc:write',

  /** Convert document formats */
  DOC_CONVERT = 'doc:convert',

  // ==================== System Operations ====================
  /** Access system information */
  SYSTEM_INFO = 'system:info',

  /** Modify system settings */
  SYSTEM_CONFIG = 'system:config',

  /** Access environment variables */
  ENV_ACCESS = 'env:access',

  // ==================== Database Operations ====================
  /** Read from database */
  DB_READ = 'db:read',

  /** Write to database */
  DB_WRITE = 'db:write',

  /** Execute database queries */
  DB_QUERY = 'db:query',

  // ==================== AI/ML Operations ====================
  /** Use AI models for inference */
  AI_INFERENCE = 'ai:inference',

  /** Train or fine-tune models */
  AI_TRAINING = 'ai:training',

  /** Access AI APIs */
  AI_API_ACCESS = 'ai:api',

  // ==================== Security Sensitive ====================
  /** Access authentication credentials */
  AUTH_ACCESS = 'auth:access',

  /** Access encryption keys */
  KEY_ACCESS = 'key:access',

  /** Access secrets or tokens */
  SECRET_ACCESS = 'secret:access',
}

/**
 * Permission groups for common skill categories
 */
export const PermissionGroups = {
  file: [
    Permission.FILE_READ,
    Permission.FILE_WRITE,
    Permission.FILE_DELETE,
    Permission.FILE_LIST,
  ],

  terminal: [
    Permission.TERMINAL_EXEC,
    Permission.TERMINAL_EXEC_SUDO,
  ],

  network: [
    Permission.WEB_SEARCH,
    Permission.API_CALL,
    Permission.NETWORK_ACCESS,
  ],

  code: [
    Permission.CODE_GENERATION,
    Permission.CODE_EXECUTION,
    Permission.CODE_REVIEW,
    Permission.CODE_REFACTOR,
  ],

  data: [
    Permission.DATA_READ,
    Permission.DATA_WRITE,
    Permission.DATA_DELETE,
    Permission.DATA_ANALYSIS,
  ],

  document: [
    Permission.DOC_READ,
    Permission.DOC_WRITE,
    Permission.DOC_CONVERT,
  ],

  system: [
    Permission.SYSTEM_INFO,
    Permission.SYSTEM_CONFIG,
    Permission.ENV_ACCESS,
  ],

  database: [
    Permission.DB_READ,
    Permission.DB_WRITE,
    Permission.DB_QUERY,
  ],

  security: [
    Permission.AUTH_ACCESS,
    Permission.KEY_ACCESS,
    Permission.SECRET_ACCESS,
  ],
} as const;

/**
 * Check if a permission belongs to a group
 */
export function isInGroup(permission: Permission, group: keyof typeof PermissionGroups): boolean {
  return (PermissionGroups[group] as readonly Permission[]).includes(permission);
}

/**
 * Get all permissions in a group
 */
export function getGroupPermissions(group: keyof typeof PermissionGroups): Permission[] {
  return [...(PermissionGroups[group] as readonly Permission[])];
}

/**
 * Default permissions for built-in skills
 */
export const DefaultSkillPermissions = {
  'code-generation': [Permission.CODE_GENERATION],
  'file-ops': [Permission.FILE_READ, Permission.FILE_WRITE, Permission.FILE_LIST],
  'terminal-exec': [Permission.TERMINAL_EXEC],
  'code-review': [Permission.CODE_REVIEW, Permission.FILE_READ],
  'data-analysis': [Permission.DATA_READ, Permission.DATA_ANALYSIS],
  'docx-processing': [Permission.DOC_READ, Permission.DOC_WRITE],
  'web-search': [Permission.WEB_SEARCH, Permission.API_CALL],
} as const;
