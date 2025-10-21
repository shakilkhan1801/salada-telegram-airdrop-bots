#!/usr/bin/env ts-node

/**
 * JWT Secret Rotation Script
 * 
 * This script generates new JWT secrets for enhanced security.
 * Run this periodically (recommended: every 30-90 days) or when security is compromised.
 * 
 * Usage:
 *   npm run secrets:rotate
 *   ts-node src/scripts/rotate-jwt-secrets.ts
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { config } from '../config';
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

interface RotationResult {
  newAdminJwtSecret: string;
  newRefreshTokenSecret: string;
  rotationTimestamp: string;
  previousSecrets?: {
    adminJwtSecret: string;
    refreshTokenSecret: string;
  };
}

const generateCryptoSecureSecret = (length: number = 64): string => {
  const bytes = Math.ceil(length / 2);
  return crypto.randomBytes(bytes).toString('hex').substring(0, length);
};

const validateCurrentSecrets = (): boolean => {
  try {
    const currentAdminSecret = config.security.adminJwtSecret;
    const currentRefreshSecret = config.security.refreshTokenSecret;
    
    console.log('\n🔍 Current JWT Secret Analysis:');
    console.log('==============================');
    
    // Check admin JWT secret
    console.log(`Admin JWT Secret Length: ${currentAdminSecret.length} chars`);
    if (currentAdminSecret.length < 64) {
      console.log('❌ Admin JWT secret is too short (minimum: 64 characters)');
      return false;
    }
    
    // Check refresh token secret
    console.log(`Refresh Token Secret Length: ${currentRefreshSecret.length} chars`);
    if (currentRefreshSecret.length < 64) {
      console.log('❌ Refresh token secret is too short (minimum: 64 characters)');
      return false;
    }
    
    // Check if they're the same (security issue)
    if (currentAdminSecret === currentRefreshSecret) {
      console.log('❌ Admin and refresh secrets are identical (security risk)');
      return false;
    }
    
    // Check for weak patterns
    const weakPatterns = ['default', 'admin', 'secret', 'jwt', 'token', '123456', 'password'];
    const adminHasWeak = weakPatterns.some(pattern => 
      currentAdminSecret.toLowerCase().includes(pattern.toLowerCase())
    );
    const refreshHasWeak = weakPatterns.some(pattern => 
      currentRefreshSecret.toLowerCase().includes(pattern.toLowerCase())
    );
    
    if (adminHasWeak) {
      console.log('❌ Admin JWT secret contains weak patterns');
      return false;
    }
    
    if (refreshHasWeak) {
      console.log('❌ Refresh token secret contains weak patterns');
      return false;
    }
    
    console.log('✅ Current secrets pass basic security validation');
    return true;
  } catch (error) {
    console.error('❌ Error validating current secrets:', error);
    return false;
  }
};

const generateNewSecrets = (): RotationResult => {
  const timestamp = new Date().toISOString();
  
  // Generate new cryptographically secure secrets
  const newAdminJwtSecret = generateCryptoSecureSecret(64);
  const newRefreshTokenSecret = generateCryptoSecureSecret(64);
  
  // Ensure they're different
  if (newAdminJwtSecret === newRefreshTokenSecret) {
    // This is extremely unlikely but let's be safe
    return generateNewSecrets();
  }
  
  const result: RotationResult = {
    newAdminJwtSecret,
    newRefreshTokenSecret,
    rotationTimestamp: timestamp,
    previousSecrets: {
      adminJwtSecret: config.security.adminJwtSecret,
      refreshTokenSecret: config.security.refreshTokenSecret
    }
  };
  
  logger.info('JWT secrets rotated', {
    timestamp,
    previousAdminSecretLength: result.previousSecrets?.adminJwtSecret.length ?? 0,
    previousRefreshSecretLength: result.previousSecrets?.refreshTokenSecret.length ?? 0,
    newAdminSecretLength: newAdminJwtSecret.length,
    newRefreshSecretLength: newRefreshTokenSecret.length
  });
  
  return result;
};

const createBackupRecord = (rotationResult: RotationResult): void => {
  try {
    const backupDir = './data/security/secret-rotations';
    const backupFile = path.join(backupDir, `rotation-${Date.now()}.json`);
    
    // Ensure backup directory exists
    fs.mkdirSync(backupDir, { recursive: true });
    
    // Create backup record (without actual secret values for security)
    const backupRecord = {
      rotationTimestamp: rotationResult.rotationTimestamp,
      previousSecretLengths: {
        adminJwtSecret: rotationResult.previousSecrets?.adminJwtSecret.length,
        refreshTokenSecret: rotationResult.previousSecrets?.refreshTokenSecret.length
      },
      newSecretLengths: {
        adminJwtSecret: rotationResult.newAdminJwtSecret.length,
        refreshTokenSecret: rotationResult.newRefreshTokenSecret.length
      },
      rotationReason: 'Manual rotation via script',
      environmentVerified: process.env.NODE_ENV || 'unknown'
    };
    
    fs.writeFileSync(backupFile, JSON.stringify(backupRecord, null, 2));
    console.log(`\n📄 Rotation record saved: ${backupFile}`);
  } catch (error) {
    console.error('⚠️  Failed to create backup record:', error);
  }
};

const updateEnvFile = (rotationResult: RotationResult): void => {
  try {
    const envPath = './.env';
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Update or add JWT secrets
    if (envContent.includes('ADMIN_JWT_SECRET=')) {
      envContent = envContent.replace(
        /ADMIN_JWT_SECRET=.*/,
        `ADMIN_JWT_SECRET=${rotationResult.newAdminJwtSecret}`
      );
    } else {
      envContent += `\nADMIN_JWT_SECRET=${rotationResult.newAdminJwtSecret}`;
    }
    
    if (envContent.includes('REFRESH_TOKEN_SECRET=')) {
      envContent = envContent.replace(
        /REFRESH_TOKEN_SECRET=.*/,
        `REFRESH_TOKEN_SECRET=${rotationResult.newRefreshTokenSecret}`
      );
    } else {
      envContent += `\nREFRESH_TOKEN_SECRET=${rotationResult.newRefreshTokenSecret}`;
    }
    
    // Add rotation timestamp comment
    envContent += `\n# JWT secrets rotated on: ${rotationResult.rotationTimestamp}`;
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Environment file updated with new secrets');
  } catch (error) {
    console.error('❌ Failed to update .env file:', error);
    console.log('\n📋 Manual .env update required:');
    console.log(`ADMIN_JWT_SECRET=${rotationResult.newAdminJwtSecret}`);
    console.log(`REFRESH_TOKEN_SECRET=${rotationResult.newRefreshTokenSecret}`);
  }
};

const showRotationInstructions = (rotationResult: RotationResult): void => {
  console.log('\n🔄 JWT Secret Rotation Complete!');
  console.log('==================================');
  console.log('');
  console.log('📋 New Secrets Generated:');
  console.log(`   Admin JWT Secret: ${rotationResult.newAdminJwtSecret}`);
  console.log(`   Refresh Token Secret: ${rotationResult.newRefreshTokenSecret}`);
  console.log('');
  console.log('⚠️  CRITICAL NEXT STEPS:');
  console.log('1. 🔄 Restart all application instances');
  console.log('2. 🚫 All existing JWT tokens will be invalidated');
  console.log('3. 🔐 All users must re-authenticate');
  console.log('4. 📡 Update load balancers/proxy configurations');
  console.log('5. 🖥️  Update monitoring systems');
  console.log('6. 🗄️  Update backup/disaster recovery procedures');
  console.log('');
  console.log('🔒 Security Considerations:');
  console.log('• Store these secrets securely');
  console.log('• Do not commit them to version control');
  console.log('• Consider rotating again in 30-90 days');
  console.log('• Monitor for any authentication issues');
  console.log('');
  console.log(`⏰ Rotated at: ${rotationResult.rotationTimestamp}`);
};

const rotateJWTSecrets = async (): Promise<void> => {
  try {
    console.log('\n🔐 JWT Secret Rotation Tool');
    console.log('===========================');
    console.log('');
    console.log('This tool will generate new JWT secrets for enhanced security.');
    console.log('⚠️  WARNING: This will invalidate all existing authentication tokens!');
    console.log('');
    
    // Validate current secrets
    const secretsValid = validateCurrentSecrets();
    if (!secretsValid) {
      console.log('\n❌ Current secrets have security issues. Rotation is REQUIRED.');
    }
    
    // Confirm rotation
    const confirm = await askQuestion('\nDo you want to proceed with JWT secret rotation? (type "yes" to confirm): ');
    if (confirm.toLowerCase() !== 'yes') {
      console.log('❌ Operation cancelled.');
      return;
    }
    
    // Generate new secrets
    console.log('\n🔄 Generating new JWT secrets...');
    const rotationResult = generateNewSecrets();
    
    // Create backup record
    createBackupRecord(rotationResult);
    
    // Ask if user wants to update .env file automatically
    const updateEnv = await askQuestion('\nUpdate .env file automatically? (Y/n): ');
    if (updateEnv.toLowerCase() !== 'n' && updateEnv.toLowerCase() !== 'no') {
      updateEnvFile(rotationResult);
    }
    
    // Show instructions
    showRotationInstructions(rotationResult);
    
    // Ask about immediate application restart
    const restartNow = await askQuestion('\nDo you want guidance on restarting the application? (Y/n): ');
    if (restartNow.toLowerCase() !== 'n' && restartNow.toLowerCase() !== 'no') {
      console.log('\n🔄 Application Restart Instructions:');
      console.log('===================================');
      console.log('');
      console.log('For development:');
      console.log('  npm run dev           # Restart development server');
      console.log('');
      console.log('For production:');
      console.log('  pm2 restart all       # If using PM2');
      console.log('  systemctl restart app # If using systemd');
      console.log('  docker-compose restart # If using Docker Compose');
      console.log('');
      console.log('💡 Consider rolling restart for zero-downtime deployment');
    }
    
  } catch (error) {
    console.error('\n❌ Error during JWT secret rotation:', error);
    logger.error('JWT secret rotation failed:', error);
  }
};

const main = async (): Promise<void> => {
  try {
    await rotateJWTSecrets();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    rl.close();
    process.exit(0);
  }
};

// Export for use as module
export { generateCryptoSecureSecret, rotateJWTSecrets };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}