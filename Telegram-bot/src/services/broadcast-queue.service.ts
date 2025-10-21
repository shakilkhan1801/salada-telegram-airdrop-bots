import { Logger } from './logger';
import { StorageManager } from '../storage';
import { Telegraf } from 'telegraf';
import { nanoid } from './id';
import jobQueue from './async-job-queue.service';

export interface BroadcastMessage {
  id: string;
  type: 'text' | 'image';
  message: string;
  mediaUrl?: string;
  targetType: 'all' | 'active' | 'specific';
  targetUsers: string[];
  scheduledAt?: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  createdAt: string;
}

export interface BroadcastHistoryEntry {
  id: string;
  type: 'text' | 'image';
  message: string;
  targetType: string;
  targetCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  sentAt: string;
  duration: number;
  status: 'sent' | 'failed';
}

export interface BroadcastResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  duration: number;
  errors?: string[];
}

export class BroadcastQueueService {
  private static instance: BroadcastQueueService;
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private bot?: Telegraf;
  private processingInterval?: NodeJS.Timeout;
  private readonly BATCH_SIZE = 10;
  private readonly BATCH_DELAY = 50; // ms between batches
  private readonly PROCESSING_INTERVAL = 10; // Check every 10ms for near-instant delivery
  private inMemoryQueue: BroadcastMessage[] = [];
  private inMemoryHistory: BroadcastHistoryEntry[] = [];

  private constructor() {}

  static getInstance(): BroadcastQueueService {
    if (!BroadcastQueueService.instance) {
      BroadcastQueueService.instance = new BroadcastQueueService();
    }
    return BroadcastQueueService.instance;
  }

  async initialize(bot: Telegraf): Promise<void> {
    try {
      this.bot = bot;
      await jobQueue.initialize();
      const self = this;
      await jobQueue.createWorker('broadcasts', async (job) => {
        const payload = (job.data as any).payload as BroadcastMessage;
        const result = await self.executeBroadcast(payload);
        return { success: result.failureCount === 0, result, duration: result.duration } as any;
      }, { concurrency: Number(process.env.BROADCAST_WORKER_CONCURRENCY || 3) });
      
      // Also start the fallback in-memory queue processor for immediate processing
      this.startQueueProcessor();
      
      this.logger.info('✅ Broadcast queue service initialized with workers and in-memory processor');
    } catch (error) {
      this.logger.error('❌ Failed to initialize broadcast queue service:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
        this.processingInterval = undefined;
      }
      this.logger.info('✅ Broadcast queue service stopped');
    } catch (error) {
      this.logger.error('❌ Error stopping broadcast queue service:', error);
      throw error;
    }
  }

  async queueBroadcast(broadcast: Omit<BroadcastMessage, 'id' | 'createdAt' | 'status'>): Promise<string> {
    try {
      const broadcastMessage: BroadcastMessage = {
        id: nanoid(),
        createdAt: new Date().toISOString(),
        status: 'pending',
        ...broadcast,
      };

      // Add to async job queue for persistence
      await jobQueue.addJob('broadcasts', { type: 'broadcast', payload: broadcastMessage });
      
      // Also add to in-memory queue for immediate processing
      this.inMemoryQueue.push(broadcastMessage);
      
      this.logger.info(`📤 Broadcast queued (async + in-memory): ${broadcastMessage.id} to ${broadcastMessage.targetUsers.length} users`);
      return broadcastMessage.id;
    } catch (error) {
      this.logger.error('❌ Failed to queue broadcast:', error);
      throw error;
    }
  }

  private startQueueProcessor(): void {
    this.logger.info(`🚀 Starting broadcast queue processor with ${this.PROCESSING_INTERVAL}ms interval`);
    
    this.processingInterval = setInterval(async () => {
      try {
        await this.processBroadcastQueue();
      } catch (error) {
        this.logger.error('❌ Error in broadcast queue processor:', error);
      }
    }, this.PROCESSING_INTERVAL);

    this.logger.info('✅ Broadcast queue processor started successfully');
  }

  private async processBroadcastQueue(): Promise<void> {
    if (!this.bot) {
      this.logger.warn('Bot instance not available for broadcast processing');
      return;
    }

    const pending = this.inMemoryQueue.filter(m => m.status === 'pending');
    
    // Only log when there are pending messages (avoid spam)
    if (pending.length > 0) {
      this.logger.debug(`Processing broadcast queue: ${pending.length} pending messages, ${this.inMemoryQueue.length} total in queue`);
    }
    
    if (!pending.length) return;

    let candidate: BroadcastMessage | null = null;
    for (const msg of pending) {
      if (!candidate) {
        candidate = msg;
      } else {
        const cTime = candidate.scheduledAt ? new Date(candidate.scheduledAt).getTime() : new Date(candidate.createdAt).getTime();
        const mTime = msg.scheduledAt ? new Date(msg.scheduledAt).getTime() : new Date(msg.createdAt).getTime();
        if (mTime < cTime) candidate = msg;
      }
    }

    if (!candidate) {
      this.logger.debug('No candidate broadcast found for processing');
      return;
    }

    this.logger.info(`🎯 Found candidate broadcast: ${candidate.id} with ${candidate.targetUsers.length} target users`);

    if (candidate.scheduledAt) {
      const scheduledTime = new Date(candidate.scheduledAt).getTime();
      if (Date.now() < scheduledTime) {
        this.logger.debug(`Broadcast ${candidate.id} scheduled for ${candidate.scheduledAt}, waiting...`);
        return;
      }
    }

    this.logger.info(`📤 Processing broadcast from in-memory queue: ${candidate.id}`);

    try {
      candidate.status = 'processing';
      this.logger.info(`🔄 Changed broadcast ${candidate.id} status to processing`);

      const result = await this.executeBroadcast(candidate);

      const history: BroadcastHistoryEntry = {
        id: candidate.id,
        type: candidate.type,
        message: candidate.message,
        targetType: candidate.targetType,
        targetCount: candidate.targetUsers.length,
        successCount: result.successCount,
        failureCount: result.failureCount,
        createdAt: candidate.createdAt,
        sentAt: new Date().toISOString(),
        duration: result.duration,
        status: result.success ? 'sent' : 'failed',
      };

      this.inMemoryHistory.push(history);
      this.inMemoryQueue = this.inMemoryQueue.filter(m => m.id !== candidate!.id);

      this.logger.info(`✅ Broadcast ${candidate.id} completed: ${result.successCount} sent, ${result.failureCount} failed in ${result.duration}ms`);
    } catch (error) {
      this.logger.error(`❌ Error processing broadcast ${candidate.id}:`, error);
      candidate.status = 'failed';
    }
  }

  private async executeBroadcast(broadcast: BroadcastMessage): Promise<BroadcastResult> {
    const startTime = Date.now();
    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    this.logger.info(`🚀 Starting broadcast execution for ${broadcast.id}`);
    this.logger.info(`📊 Target users: ${broadcast.targetUsers.length}`);
    this.logger.info(`📝 Message type: ${broadcast.type}`);
    this.logger.info(`👥 First 5 target users: ${broadcast.targetUsers.slice(0, 5).join(', ')}`);

    if (!this.bot) {
      this.logger.error('❌ Bot instance not available for broadcast execution');
      throw new Error('Bot instance not available');
    }

    const batches: string[][] = [];
    for (let i = 0; i < broadcast.targetUsers.length; i += this.BATCH_SIZE) {
      batches.push(broadcast.targetUsers.slice(i, i + this.BATCH_SIZE));
    }
    
    this.logger.info(`📦 Processing ${batches.length} batches of max ${this.BATCH_SIZE} users each`);

    for (const batch of batches) {
      const batchIndex = batches.indexOf(batch) + 1;
      this.logger.info(`🔄 Processing batch ${batchIndex}/${batches.length} with ${batch.length} users`);
      
      const promises = batch.map(async (userId) => {
        try {
          this.logger.debug(`📤 Sending to user ${userId}`);
          await this.sendBroadcastToUser(userId, broadcast);
          successCount++;
          this.logger.debug(`✅ Broadcast sent to user ${userId}`);
          return { success: true };
        } catch (err) {
          failureCount++;
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          errors.push(`User ${userId}: ${errorMessage}`);
          this.logger.error(`❌ Failed to send broadcast to user ${userId}: ${errorMessage}`);
          return { success: false };
        }
      });

      await Promise.allSettled(promises);
      if (batches.indexOf(batch) < batches.length - 1) {
        await this.delay(this.BATCH_DELAY);
      }
    }

    const duration = Date.now() - startTime;
    
    this.logger.info(`📊 Broadcast execution completed for ${broadcast.id}:`);
    this.logger.info(`  ✅ Success: ${successCount}/${broadcast.targetUsers.length}`);
    this.logger.info(`  ❌ Failed: ${failureCount}/${broadcast.targetUsers.length}`);
    this.logger.info(`  ⏱️ Duration: ${duration}ms`);
    
    if (errors.length > 0) {
      this.logger.warn(`🚨 Errors encountered:`);
      errors.slice(0, 5).forEach(error => this.logger.warn(`  - ${error}`));
      if (errors.length > 5) {
        this.logger.warn(`  ... and ${errors.length - 5} more errors`);
      }
    }
    
    return {
      success: failureCount === 0,
      successCount,
      failureCount,
      duration,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private async sendBroadcastToUser(userId: string, broadcast: BroadcastMessage): Promise<void> {
    if (!this.bot) {
      this.logger.error('❌ Bot instance not available for sending message');
      throw new Error('Bot instance not available');
    }

    if (!this.bot.telegram) {
      this.logger.error('❌ Bot telegram instance not available');
      throw new Error('Bot telegram instance not available');
    }

    this.logger.debug(`📤 Attempting to send ${broadcast.type} broadcast to user ${userId}`);
    this.logger.debug(`🤖 Bot token available: ${!!process.env.BOT_TOKEN}`);

    // Validate user ID
    if (!userId || userId === 'undefined' || userId === 'null') {
      this.logger.error(`❌ Invalid user ID: ${userId}`);
      throw new Error(`Invalid user ID: ${userId}`);
    }

    switch (broadcast.type) {
      case 'image':
        if (!broadcast.mediaUrl) throw new Error('Image URL is required for image broadcast');
        try {
          await this.bot.telegram.sendPhoto(userId, broadcast.mediaUrl, {
            caption: broadcast.message || '',
            parse_mode: 'HTML',
          });
          this.logger.debug(`Successfully sent photo broadcast to user ${userId}`);
        } catch (photoError: any) {
          this.logger.warn(`Failed to send as photo to user ${userId}: ${photoError.message}, trying as document`);
          try {
            await this.bot.telegram.sendDocument(userId, broadcast.mediaUrl, {
              caption: broadcast.message || '',
              parse_mode: 'HTML',
            });
            this.logger.debug(`Successfully sent document broadcast to user ${userId}`);
          } catch (docError: any) {
            this.logger.error(`Failed to send document to user ${userId}: ${docError.message}`);
            // Auto-flag user as blocked if Telegram reports the bot was blocked
            const msg = String(docError?.message || '');
            if (/403/.test(msg) && /blocked by the user/i.test(msg)) {
              try {
                await this.storage.update('users', { isBlocked: true, blockedAt: new Date().toISOString(), blockedReason: 'telegram_bot_blocked' } as any, String(userId));
                this.logger.info(`🚫 Marked user ${userId} as blocked due to Telegram 403`);
              } catch (flagErr) {
                this.logger.warn(`Failed to auto-flag user ${userId} as blocked: ${flagErr instanceof Error ? flagErr.message : flagErr}`);
              }
            }
            throw docError;
          }
        }
        break;
      case 'text':
      default:
        try {
          await this.bot.telegram.sendMessage(userId, broadcast.message, { parse_mode: 'HTML' });
          this.logger.debug(`Successfully sent text broadcast to user ${userId}`);
        } catch (textError: any) {
          this.logger.error(`Failed to send text broadcast to user ${userId}: ${textError.message}`);
          // Auto-flag user as blocked if Telegram reports the bot was blocked
          const msg = String(textError?.message || '');
          if (/403/.test(msg) && /blocked by the user/i.test(msg)) {
            try {
              await this.storage.update('users', { isBlocked: true, blockedAt: new Date().toISOString(), blockedReason: 'telegram_bot_blocked' } as any, String(userId));
              this.logger.info(`🚫 Marked user ${userId} as blocked due to Telegram 403`);
            } catch (flagErr) {
              this.logger.warn(`Failed to auto-flag user ${userId} as blocked: ${flagErr instanceof Error ? flagErr.message : flagErr}`);
            }
          }
          throw textError;
        }
        break;
    }
  }

  private async saveBroadcastHistory(historyEntry: BroadcastHistoryEntry): Promise<void> {
    try {
      this.inMemoryHistory.push(historyEntry);
      this.logger.debug('📊 Broadcast history updated: ' + historyEntry.id);
    } catch (error) {
      this.logger.error('❌ Failed to save broadcast history (in-memory):', error);
    }
  }

  async getBroadcastHistory(limit: number = 50): Promise<BroadcastHistoryEntry[]> {
    try {
      const arr = [...this.inMemoryHistory];
      arr.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
      return arr.slice(0, limit);
    } catch (error) {
      this.logger.error('❌ Failed to get broadcast history:', error);
      return [];
    }
  }

  async getQueueStatus(): Promise<BroadcastMessage | null> {
    try {
      const msg = this.inMemoryQueue.find(m => m.status === 'pending') || null;
      return msg;
    } catch (error) {
      this.logger.error('❌ Failed to get queue status:', error);
      return null;
    }
  }

  async cancelBroadcast(broadcastId: string): Promise<boolean> {
    try {
      const idx = this.inMemoryQueue.findIndex(m => m.id === broadcastId);
      if (idx === -1) return false;
      if (this.inMemoryQueue[idx].status === 'processing') throw new Error('Cannot cancel broadcast that is currently being processed');
      this.inMemoryQueue.splice(idx, 1);
      this.logger.info('🗑️ Broadcast ' + broadcastId + ' cancelled');
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to cancel broadcast ' + broadcastId + ':', error);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
