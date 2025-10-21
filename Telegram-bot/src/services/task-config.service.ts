import * as path from 'path';

export interface TaskManagerConfig {
  runtimeTasksPath: string;
  enableAutoBackup: boolean;
  backupInterval: number; // minutes
}

/**
 * Get TaskManager configuration based on environment
 */
export function getTaskManagerConfig(): TaskManagerConfig {
  const rootDir = process.cwd();
  
  return {
    runtimeTasksPath: path.join(rootDir, 'data/tasks.json'),
    enableAutoBackup: process.env.ENABLE_AUTO_BACKUP !== 'false', // Respect env variable
    backupInterval: 60 // minutes
  };
}

/**
 * Get task configuration for different environments
 */
export function getTaskConfigForEnvironment(env: 'development' | 'production' | 'testing'): TaskManagerConfig {
  const rootDir = process.cwd();
  
  const configs = {
    development: {
      runtimeTasksPath: path.join(rootDir, 'data/tasks.json'),
      enableAutoBackup: true,
      backupInterval: 30 // More frequent backups in dev
    },
    production: {
      runtimeTasksPath: path.join(rootDir, 'data/tasks.json'),
      enableAutoBackup: true,
      backupInterval: 120 // Less frequent in production
    },
    testing: {
      runtimeTasksPath: path.join(rootDir, 'data/test-tasks.json'),
      enableAutoBackup: false, // No auto backup in tests
      backupInterval: 60
    }
  } as const;

  return configs[env];
}

/**
 * Validate task manager configuration
 */
export function validateTaskConfig(config: TaskManagerConfig): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.runtimeTasksPath || config.runtimeTasksPath.trim() === '') {
    errors.push('runtimeTasksPath is required');
  }

  if (config.enableAutoBackup && (!config.backupInterval || config.backupInterval < 5)) {
    errors.push('backupInterval must be at least 5 minutes when auto backup is enabled');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}