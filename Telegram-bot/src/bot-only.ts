import 'reflect-metadata';
import { Logger } from './services/logger';
import { getConfig } from './config';
import { storage } from './storage';
import { initializeSecurity } from './security';
import { TelegramBot } from './bot/telegram-bot';

// Initialize logger
const logger = Logger.getInstance();

async function startBotOnly() {
  try {
    logger.info('🚀 Starting Telegram Bot Only (No Admin Server)...');
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Initialize storage
    logger.info('📊 Initializing storage...');
    await storage.initialize();
    logger.info('✅ Storage initialized successfully');

    // Initialize security
    logger.info('🔒 Initializing security system...');
    await initializeSecurity();
    logger.info('✅ Security system initialized');

    // Initialize bot
    logger.info('🤖 Initializing Telegram bot...');
    const bot = new TelegramBot();
    await bot.initialize();
    logger.info('✅ Telegram bot initialized');

    // Start bot
    logger.info('🤖 Starting Telegram bot...');
    await bot.start();
    logger.info('✅ Telegram bot started successfully!');

    // Keep process alive
    process.on('SIGINT', async () => {
      logger.info('🛑 Shutting down bot...');
      await bot.stop();
      await storage.close();
      process.exit(0);
    });

    logger.info('✅ Bot is running and ready to receive messages!');
    
  } catch (error) {
    logger.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

startBotOnly();