#!/usr/bin/env ts-node

/**
 * Admin User Initialization Script
 * 
 * This script initializes the first super admin user with secure credentials.
 * Run this script on first setup or when you need to create additional admin users.
 * 
 * Usage:
 *   npm run init-admin
 *   ts-node src/scripts/init-admin.ts
 */

import * as readline from 'readline';
import * as crypto from 'crypto';
import { config } from '../config';
import { storage } from '../storage';
import { authController } from '../admin/controllers/auth-controller';
import { AdminRole } from '../types/admin.types';
import { logger } from '../services/logger';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

interface AdminUserInput {
  username: string;
  password: string;
  confirmPassword: string;
  role: AdminRole;
  telegramId?: string;
  email?: string;
}

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

const generateSecurePassword = (): string => {
  const length = 16;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  let password = '';
  
  // Ensure at least one character from each required category
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]; // lowercase
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]; // uppercase
  password += '0123456789'[Math.floor(Math.random() * 10)]; // number
  password += '!@#$%^&*()_+-='[Math.floor(Math.random() * 13)]; // special char
  
  // Fill the rest randomly
  for (let i = 4; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
};

const validateInput = (input: AdminUserInput): string[] => {
  const errors: string[] = [];
  
  if (!input.username || input.username.length < 3) {
    errors.push('Username must be at least 3 characters long');
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(input.username)) {
    errors.push('Username can only contain letters, numbers, underscores, and hyphens');
  }
  
  if (!input.password) {
    errors.push('Password is required');
  }
  
  if (input.password !== input.confirmPassword) {
    errors.push('Passwords do not match');
  }
  
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.push('Invalid email format');
  }
  
  if (input.telegramId) {
    const t = input.telegramId.trim();
    const isNumeric = /^\d+$/.test(t);
    const isUsername = /^@?[a-zA-Z0-9_]{3,}$/.test(t);
    if (!isNumeric && !isUsername) {
      errors.push('Telegram ID/Username must be numeric ID or @username');
    } else {
      input.telegramId = isNumeric ? t : t.replace(/^@/, '');
    }
  }
  
  return errors;
};

const showWelcome = () => {
  console.log('\\n🔐 Admin User Initialization Tool');
  console.log('==================================');
  console.log('');
  console.log('This tool will help you create a secure admin user account.');
  console.log('Please ensure you store the credentials securely.');
  console.log('');
};

const showSecurityNotice = () => {
  console.log('\\n⚠️  SECURITY NOTICE:');
  console.log('- Use a strong, unique password');
  console.log('- Store credentials in a secure password manager');
  console.log('- Consider enabling 2FA after account creation');
  console.log('- Change default passwords immediately');
  console.log('');
};

const createAdminUser = async (): Promise<void> => {
  try {
    showWelcome();
    showSecurityNotice();

    await storage.initialize();

    // Check if we already have admin users
    const adminUsers = await storage.list('admin_users');
    const hasExistingAdmins = adminUsers.length > 0;
    
    if (hasExistingAdmins) {
      const proceed = await askQuestion('Admin users already exist. Continue creating another? (y/N): ');
      if (proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
        console.log('Operation cancelled.');
        return;
      }
    }

    const input: AdminUserInput = {
      username: '',
      password: '',
      confirmPassword: '',
      role: 'admin'
    };

    // Get username
    input.username = await askQuestion('Enter username: ');
    
    // Get role
    if (!hasExistingAdmins) {
      console.log('Creating first admin user with super_admin role...');
      input.role = 'super_admin';
    } else {
      console.log('Available roles: super_admin, admin, moderator, viewer');
      const roleInput = await askQuestion('Enter role (admin): ') || 'admin';
      input.role = roleInput as AdminRole;
    }
    
    // Optional fields
    input.email = await askQuestion('Enter email (optional): ') || undefined;
    input.telegramId = await askQuestion('Enter Telegram ID (optional): ') || undefined;
    
    // Password generation or manual entry
    const useGenerated = await askQuestion('Generate secure password automatically? (Y/n): ');
    
    if (useGenerated.toLowerCase() === 'n' || useGenerated.toLowerCase() === 'no') {
      // Manual password entry
      input.password = await askSecretQuestion('Enter password: ');
      input.confirmPassword = await askSecretQuestion('Confirm password: ');
    } else {
      // Generate secure password
      input.password = generateSecurePassword();
      input.confirmPassword = input.password;
      console.log('\\n🔑 Generated secure password (save this securely!):');
      console.log(`Password: ${input.password}`);
      console.log('');
      console.log('Save the password securely and proceed.');
    }
    
    // Validate input
    const validationErrors = validateInput(input);
    if (validationErrors.length > 0) {
      console.log('\\n❌ Validation errors:');
      validationErrors.forEach(error => console.log(`  • ${error}`));
      return;
    }
    
    // Create the admin user
    console.log('\\n🔄 Creating admin user...');
    
    const result = await authController.createAdminUser(
      input.username,
      input.password,
      input.role,
      input.telegramId,
      input.email
    );
    
    if (result.success) {
      console.log('\\n✅ Admin user created successfully!');
      console.log('');
      console.log('User Details:');
      console.log(`  • Username: ${result.user?.username}`);
      console.log(`  • Role: ${result.user?.role}`);
      console.log(`  • Email: ${result.user?.email || 'Not provided'}`);
      console.log(`  • Telegram ID: ${result.user?.telegramId || 'Not provided'}`);
      console.log(`  • User ID: ${result.user?.id}`);
      console.log('');
      console.log('🔒 Remember to:');
      console.log('  1. Store the password securely');
      console.log('  2. Test login functionality');
      console.log('  3. Configure environment variables if needed');
      console.log('  4. Set up proper backup procedures');
      
      // Create a summary file
      const summaryFile = `admin_user_${input.username}_${new Date().getTime()}.txt`;
      const dataDir = (config as any).paths?.data || './data';
      require('fs').mkdirSync(dataDir, { recursive: true });
      const pathMod = require('path');
      const summaryPath = pathMod.join(dataDir, summaryFile);
      const summary = `
Admin User Creation Summary
==========================
Created: ${new Date().toISOString()}
Username: ${input.username}
Role: ${input.role}
Email: ${input.email || 'Not provided'}
Telegram ID: ${input.telegramId || 'Not provided'}
User ID: ${result.user?.id}

IMPORTANT: Store the password securely and delete this file after saving it to your password manager.
`;
      
      require('fs').writeFileSync(summaryPath, summary);
      console.log(`\\n📄 Summary saved to: ${summaryPath}`);
      console.log('❗ DELETE THIS FILE after saving the password to your password manager!');
      
    } else {
      console.log('\\n❌ Failed to create admin user:');
      result.errors?.forEach(error => console.log(`  • ${error}`));
    }
    
  } catch (error) {
    console.error('\\n❌ Error creating admin user:', error);
    logger.error('Admin user creation failed:', error);
  }
};

const main = async (): Promise<void> => {
  try {
    await createAdminUser();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    try { await storage.close(); } catch {}
    rl.close();
    process.exit(0);
  }
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { createAdminUser };