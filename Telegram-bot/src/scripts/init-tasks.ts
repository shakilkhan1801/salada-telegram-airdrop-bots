#!/usr/bin/env node

import { TaskManager } from '../services/task-manager.service';
import { getTaskManagerConfig } from '../services/task-config.service';
import { Logger } from '../services/logger';

const logger = Logger.getInstance();

async function initializeTasks() {
  try {
    console.log('🚀 Initializing Task System...\n');

    // Get configuration
    const config = getTaskManagerConfig();
    console.log(`📁 Default tasks: TypeScript module (src/bot/handlers/default-tasks.ts)`);
    console.log(`💾 Runtime tasks: ${config.runtimeTasksPath}`);
    console.log(`🔄 Auto backup: ${config.enableAutoBackup ? 'Enabled' : 'Disabled'}\n`);

    // Initialize TaskManager
    const taskManager = TaskManager.getInstance(config);
    await taskManager.initialize();

    // Get task statistics
    const stats = await taskManager.getTaskStats();
    console.log('📊 Task Statistics:');
    console.log(`   Total: ${stats.total}`);
    console.log(`   Active: ${stats.active}`);
    console.log(`   Inactive: ${stats.inactive}`);
    console.log(`   Daily: ${stats.daily}`);
    console.log(`   Permanent: ${stats.permanent}`);
    console.log(`   Temporary: ${stats.temporary}`);
    console.log(`   Points range: ${stats.pointsRange.min} - ${stats.pointsRange.max} (avg: ${Math.round(stats.pointsRange.avg)})`);
    
    console.log('\n📋 Categories:');
    Object.entries(stats.categories).forEach(([category, count]) => {
      console.log(`   ${category}: ${count}`);
    });
    
    console.log('\n🔧 Types:');
    Object.entries(stats.types).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    // List all tasks
    console.log('\n📝 Available Tasks:');
    const allTasks = await taskManager.getAllTasks();
    allTasks.forEach((task, index) => {
      const status = task.isActive ? '✅' : '❌';
      const type = task.isPermanent ? '📌' : '🔄';
      console.log(`   ${index + 1}. ${status} ${type} ${task.title} (${task.points} points)`);
    });

    // Create backup
    console.log('\n💾 Creating backup...');
    const backupPath = await taskManager.createBackup();
    console.log(`   Backup created: ${backupPath}`);

    console.log('\n✅ Task system initialization completed successfully!');
    
  } catch (error) {
    console.error('❌ Failed to initialize task system:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  initializeTasks()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Initialization failed:', error);
      process.exit(1);
    });
}

export { initializeTasks };