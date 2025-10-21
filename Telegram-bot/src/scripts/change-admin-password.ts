#!/usr/bin/env ts-node

/**
 * Admin Password Change Script
 * 
 * This script allows changing admin user passwords with proper validation.
 * 
 * Usage:
 *   npm run admin:password
 *   ts-node src/scripts/change-admin-password.ts
 */

import * as readline from 'readline';
import { storage } from '../storage';
import { authController } from '../admin/controllers/auth-controller';
import { AdminUser } from '../types/admin.types';
import { logger } from '../services/logger';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
};

const askSecretQuestion = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    let input = '';
    process.stdin.on('data', (key: Buffer) => {
      const str = key.toString('utf8');
      if (str === '\u0003') { // Ctrl+C
        process.exit();
      } else if (str === '\r' || str === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(input);
      } else if (str === '\u007f') { // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        input += str;
        process.stdout.write('*');
      }
    });
  });
};

const listAdminUsers = async (): Promise<AdminUser[]> => {
  try {
    const adminUserIds = await storage.list('admin_users');
    const adminUsers: AdminUser[] = [];
    
    for (const id of adminUserIds) {
      const user = await storage.get<AdminUser>('admin_users', id);
      if (user) {
        adminUsers.push(user);
      }
    }
    
    return adminUsers;
  } catch (error) {
    console.error('Error fetching admin users:', error);
    return [];
  }
};

const changePassword = async (): Promise<void> => {
  try {
    console.log('\n🔐 Admin Password Change Tool');
    console.log('============================');
    console.log('');

    // List available admin users
    const adminUsers = await listAdminUsers();
    
    if (adminUsers.length === 0) {
      console.log('❌ No admin users found. Please create an admin user first.');
      console.log('Run: npm run init-admin');
      return;
    }
    
    console.log('Available admin users:');
    adminUsers.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.username} (${user.role}) - ${user.isActive ? 'Active' : 'Inactive'}`);
    });
    console.log('');
    
    // Select user
    const userSelection = await askQuestion('Select user number (or enter username): ');
    let selectedUser: AdminUser | undefined;
    
    if (/^\d+$/.test(userSelection)) {
      const index = parseInt(userSelection) - 1;
      selectedUser = adminUsers[index];
    } else {
      selectedUser = adminUsers.find(user => user.username === userSelection);
    }
    
    if (!selectedUser) {
      console.log('❌ Invalid selection. User not found.');
      return;
    }
    
    console.log(`\\nChanging password for: ${selectedUser.username} (${selectedUser.role})`);
    
    // Get current password
    const currentPassword = await askSecretQuestion('Enter current password: ');
    
    // Get new password
    const newPassword = await askSecretQuestion('Enter new password: ');
    const confirmPassword = await askSecretQuestion('Confirm new password: ');
    
    if (newPassword !== confirmPassword) {
      console.log('\\n❌ Passwords do not match!');
      return;
    }
    
    // Change password
    console.log('\\n🔄 Changing password...');
    
    const result = await authController.changePassword(
      selectedUser.id,
      currentPassword,
      newPassword
    );
    
    if (result.success) {
      console.log('✅ Password changed successfully!');
      console.log('');
      console.log('🔒 Security reminders:');
      console.log('  • Store the new password securely');
      console.log('  • Test login with the new password');
      console.log('  • Consider updating backup procedures');
      console.log('  • Log out all existing sessions if needed');
    } else {
      console.log('\\n❌ Failed to change password:');
      result.errors?.forEach(error => console.log(`  • ${error}`));
    }
    
  } catch (error) {
    console.error('\\n❌ Error changing password:', error);
    logger.error('Password change failed:', error);
  }
};

const main = async (): Promise<void> => {
  try {
    await changePassword();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    rl.close();
    process.exit(0);
  }
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { changePassword };