#!/usr/bin/env node

import { TaskManager } from '../services/task-manager.service';
import { getTaskManagerConfig } from '../services/task-config.service';
import { Task } from '../types/task.types';
import * as readline from 'readline';

class TaskManagerCLI {
  private taskManager!: TaskManager;
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async initialize() {
    console.log('🚀 Task Manager CLI\n');
    
    const config = getTaskManagerConfig();
    this.taskManager = TaskManager.getInstance(config);
    await this.taskManager.initialize();
    
    console.log('✅ Task Manager initialized\n');
  }

  async showMenu() {
    console.log('\n📋 Task Management Menu:');
    console.log('1. List all tasks');
    console.log('2. View task details');
    console.log('3. Add new task');
    console.log('4. Edit task');
    console.log('5. Remove task');
    console.log('6. Task statistics');
    console.log('7. Create backup');
    console.log('8. Refresh tasks');
    console.log('9. Filter tasks');
    console.log('0. Exit\n');

    const choice = await this.askQuestion('Choose an option: ');
    await this.handleChoice(choice);
  }

  async handleChoice(choice: string) {
    switch (choice.trim()) {
      case '1':
        await this.listTasks();
        break;
      case '2':
        await this.viewTaskDetails();
        break;
      case '3':
        await this.addTask();
        break;
      case '4':
        await this.editTask();
        break;
      case '5':
        await this.removeTask();
        break;
      case '6':
        await this.showStatistics();
        break;
      case '7':
        await this.createBackup();
        break;
      case '8':
        await this.refreshTasks();
        break;
      case '9':
        await this.filterTasks();
        break;
      case '0':
        console.log('👋 Goodbye!');
        this.rl.close();
        return;
      default:
        console.log('❌ Invalid option. Please try again.');
    }
    
    await this.showMenu();
  }

  async listTasks() {
    console.log('\n📝 All Tasks:');
    const tasks = await this.taskManager.getAllTasks();
    
    if (tasks.length === 0) {
      console.log('   No tasks found');
      return;
    }

    tasks.forEach((task, index) => {
      const status = task.isActive ? '✅' : '❌';
      const type = task.isPermanent ? '📌' : '🔄';
      const daily = task.isDaily ? '📅' : '';
      console.log(`   ${index + 1}. ${status} ${type} ${daily} ${task.title} (${task.points} points) [${task.category}]`);
    });
  }

  async viewTaskDetails() {
    const taskId = await this.askQuestion('\nEnter task ID: ');
    const task = await this.taskManager.getTask(taskId);
    
    if (!task) {
      console.log('❌ Task not found');
      return;
    }

    console.log(`\n📝 Task Details:`);
    console.log(`   ID: ${task.id}`);
    console.log(`   Title: ${task.title}`);
    console.log(`   Description: ${task.description}`);
    console.log(`   Category: ${task.category}`);
    console.log(`   Type: ${task.type}`);
    console.log(`   Points: ${task.points}`);
    console.log(`   Active: ${task.isActive ? 'Yes' : 'No'}`);
    console.log(`   Daily: ${task.isDaily ? 'Yes' : 'No'}`);
    console.log(`   Permanent: ${task.isPermanent ? 'Yes' : 'No'}`);
    console.log(`   Verification: ${task.verificationMethod}`);
    console.log(`   Order: ${task.order}`);
    console.log(`   Created: ${task.createdAt}`);
    console.log(`   Updated: ${task.updatedAt}`);
    
    if (task.buttons.length > 0) {
      console.log(`   Buttons:`);
      task.buttons.forEach((btn, index) => {
        console.log(`     ${index + 1}. ${btn.text} (${btn.action})`);
      });
    }
  }

  async addTask() {
    console.log('\n➕ Add New Task:');
    
    const id = await this.askQuestion('Task ID: ');
    const title = await this.askQuestion('Title: ');
    const description = await this.askQuestion('Description: ');
    const category = await this.askQuestion('Category (tele_social|social|premium|daily|engagement|referral): ');
    const type = await this.askQuestion('Type (telegram_join|twitter_follow|daily_bonus|etc): ');
    const points = parseInt(await this.askQuestion('Points: '));
    const isActive = (await this.askQuestion('Active (y/n): ')).toLowerCase() === 'y';
    const isDaily = (await this.askQuestion('Daily task (y/n): ')).toLowerCase() === 'y';

    const newTask: Task = {
      id,
      title,
      description,
      category: category as any,
      type: type as any,
      points,
      icon: '📝',
      verificationMethod: 'user_submission',
      isActive,
      isDaily,
      maxCompletions: 1,
      completionCount: 0,
      requirements: {},
      validation: {
        submissionRequired: true,
        autoApprove: false,
        reviewRequired: true
      },
      buttons: [
        {
          text: '✅ Complete',
          action: 'complete',
          style: 'success'
        }
      ],
      order: 99,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        successMessage: 'Task completed!',
        failureMessage: 'Task failed!'
      },
      isPermanent: false
    };

    try {
      await this.taskManager.saveTask(newTask);
      console.log('✅ Task added successfully!');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`❌ Failed to add task: ${msg}`);
    }
  }

  async editTask() {
    const taskId = await this.askQuestion('\nEnter task ID to edit: ');
    const task = await this.taskManager.getTask(taskId);
    
    if (!task) {
      console.log('❌ Task not found');
      return;
    }

    if (task.isPermanent) {
      console.log('⚠️ Warning: This is a permanent task. Changes will be temporary.');
    }

    console.log(`\nEditing task: ${task.title}`);
    
    const newTitle = await this.askQuestion(`Title (${task.title}): `);
    const newDescription = await this.askQuestion(`Description (${task.description}): `);
    const newPoints = await this.askQuestion(`Points (${task.points}): `);
    const newActive = await this.askQuestion(`Active (${task.isActive ? 'y' : 'n'}): `);

    const updatedTask = {
      ...task,
      title: newTitle || task.title,
      description: newDescription || task.description,
      points: newPoints ? parseInt(newPoints) : task.points,
      isActive: newActive ? newActive.toLowerCase() === 'y' : task.isActive,
      updatedAt: new Date().toISOString(),
      isPermanent: false // Mark as temporary when edited
    };

    try {
      await this.taskManager.saveTask(updatedTask);
      console.log('✅ Task updated successfully!');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`❌ Failed to update task: ${msg}`);
    }
  }

  async removeTask() {
    const taskId = await this.askQuestion('\nEnter task ID to remove: ');
    const task = await this.taskManager.getTask(taskId);
    
    if (!task) {
      console.log('❌ Task not found');
      return;
    }

    if (task.isPermanent) {
      console.log('❌ Cannot remove permanent task');
      return;
    }

    const confirm = await this.askQuestion(`Are you sure you want to remove "${task.title}"? (y/n): `);
    if (confirm.toLowerCase() !== 'y') {
      console.log('Operation cancelled');
      return;
    }

    const success = await this.taskManager.removeTask(taskId);
    if (success) {
      console.log('✅ Task removed successfully!');
    } else {
      console.log('❌ Failed to remove task');
    }
  }

  async showStatistics() {
    console.log('\n📊 Task Statistics:');
    const stats = await this.taskManager.getTaskStats();
    
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
  }

  async createBackup() {
    console.log('\n💾 Creating backup...');
    try {
      const backupPath = await this.taskManager.createBackup();
      console.log(`✅ Backup created: ${backupPath}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`❌ Backup failed: ${msg}`);
    }
  }

  async refreshTasks() {
    console.log('\n🔄 Refreshing tasks...');
    try {
      await this.taskManager.refresh();
      console.log('✅ Tasks refreshed successfully!');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`❌ Refresh failed: ${msg}`);
    }
  }

  async filterTasks() {
    console.log('\n🔍 Filter Tasks:');
    const category = await this.askQuestion('Category (or press enter to skip): ');
    const isActive = await this.askQuestion('Active only? (y/n/enter to skip): ');
    const isDaily = await this.askQuestion('Daily only? (y/n/enter to skip): ');
    
    const filter: any = {};
    if (category) filter.category = category;
    if (isActive === 'y') filter.isActive = true;
    if (isActive === 'n') filter.isActive = false;
    if (isDaily === 'y') filter.isDaily = true;
    if (isDaily === 'n') filter.isDaily = false;

    const tasks = await this.taskManager.getFilteredTasks(filter);
    
    console.log(`\n📝 Filtered Tasks (${tasks.length} found):`);
    tasks.forEach((task, index) => {
      const status = task.isActive ? '✅' : '❌';
      const type = task.isPermanent ? '📌' : '🔄';
      const daily = task.isDaily ? '📅' : '';
      console.log(`   ${index + 1}. ${status} ${type} ${daily} ${task.title} (${task.points} points)`);
    });
  }

  private askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  async run() {
    try {
      await this.initialize();
      await this.showMenu();
    } catch (error) {
      console.error('❌ CLI Error:', error);
    } finally {
      this.rl.close();
    }
  }
}

// Run if called directly
if (require.main === module) {
  const cli = new TaskManagerCLI();
  cli.run().catch(console.error);
}

export { TaskManagerCLI };