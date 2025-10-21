import { Context, Markup } from 'telegraf';
import { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../../services/logger';

/**
 * Message sending options interface
 */
interface MessageOptions {
  reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  protect_content?: boolean;
  link_preview_options?: { is_disabled?: boolean };
}

/**
 * Shared message management service to eliminate duplicate message handling
 * logic across all bot handlers
 */
export class MessageService {
  private static readonly logger = Logger.getInstance();

  /**
   * Smart message sender - edits if callback query, sends new if regular message
   * This is the most commonly duplicated pattern across all handlers
   */
  static async editOrReply(
    ctx: Context,
    text: string,
    options: MessageOptions = {}
  ): Promise<boolean> {
    // Set default parse mode
    const messageOptions = {
      parse_mode: 'HTML' as const,
      ...options
    };

    const preferReply = (process.env.PREFER_REPLY_OVER_EDIT ?? 'true').toLowerCase() !== 'false';
    const replaceMode = (process.env.REPLACE_MODE ?? 'false').toLowerCase() === 'true';

    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      if (replaceMode) {
        return await this.replaceOrReply(ctx, text, messageOptions);
      }
      if (!preferReply) {
        return await this.safeEditMessage(ctx, text, messageOptions);
      }
    }
    return await this.safeReply(ctx, text, messageOptions);
  }

  private static lastReplaceAt = new Map<number, number>();

  static async replaceOrReply(
    ctx: Context,
    text: string,
    options: MessageOptions = {}
  ): Promise<boolean> {
    const chatId = ctx.chat?.id;
    const msgId = (ctx as any)?.callbackQuery?.message?.message_id as number | undefined;
    if (!chatId || !msgId) {
      return await this.safeReply(ctx, text, options);
    }

    const cooldownMs = parseInt(process.env.REPLACE_COOLDOWN_MS || '250', 10);
    const now = Date.now();
    const last = this.lastReplaceAt.get(chatId) || 0;
    if (now - last < cooldownMs) {
      return await this.safeEditMessage(ctx, text, options);
    }
    this.lastReplaceAt.set(chatId, now);

    await this.safeDeleteMessage(ctx, msgId);
    const ok = await this.safeReply(ctx, text, options);
    if (ok) return true;
    return await this.safeEditMessage(ctx, text, options);
  }

  /**
   * Safely edit message with comprehensive error handling
   */
  static async safeEditMessage(
    ctx: Context,
    text: string,
    options: MessageOptions = {}
  ): Promise<boolean> {
    try {
      // Only InlineKeyboardMarkup is allowed for editMessageText; strip others
      const editOptions: any = { ...options };
      if (editOptions.reply_markup && !('inline_keyboard' in editOptions.reply_markup)) {
        delete editOptions.reply_markup;
      }
      await ctx.editMessageText(text, editOptions);
      return true;
    } catch (error: any) {
      return await this.handleEditMessageError(ctx, text, options, error);
    }
  }

  /**
   * Safely send reply message with error handling
   */
  static async safeReply(
    ctx: Context,
    text: string,
    options: MessageOptions = {}
  ): Promise<boolean> {
    try {
      await ctx.reply(text, options);
      return true;
    } catch (error: any) {
      this.logger.error('Error sending reply message:', error);
      
      // Try sending without markup on error
      if (options.reply_markup) {
        try {
          const fallbackOptions = { ...options };
          delete fallbackOptions.reply_markup;
          await ctx.reply(text, fallbackOptions);
          return true;
        } catch (fallbackError) {
          this.logger.error('Error sending fallback reply:', fallbackError);
        }
      }
      
      return false;
    }
  }

  /**
   * Send message with inline keyboard
   */
  static async sendWithInlineKeyboard(
    ctx: Context,
    text: string,
    keyboard: InlineKeyboardMarkup,
    parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
  ): Promise<boolean> {
    return await this.editOrReply(ctx, text, {
      reply_markup: keyboard,
      parse_mode: parseMode
    });
  }

  /**
   * Send message with reply keyboard
   */
  static async sendWithReplyKeyboard(
    ctx: Context,
    text: string,
    keyboard: ReplyKeyboardMarkup,
    parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
  ): Promise<boolean> {
    return await this.safeReply(ctx, text, {
      reply_markup: keyboard,
      parse_mode: parseMode
    });
  }

  /**
   * Remove keyboard and send message
   */
  static async sendWithoutKeyboard(
    ctx: Context,
    text: string,
    parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
  ): Promise<boolean> {
    return await this.safeReply(ctx, text, {
      reply_markup: { remove_keyboard: true } as ReplyKeyboardRemove,
      parse_mode: parseMode
    });
  }

  /**
   * Delete message safely
   */
  static async safeDeleteMessage(ctx: Context, messageId?: number): Promise<boolean> {
    try {
      if (messageId) {
        await ctx.telegram.deleteMessage(ctx.chat!.id, messageId);
      } else if (ctx.message) {
        await ctx.deleteMessage();
      }
      return true;
    } catch (error: any) {
      // Don't log errors for message deletion - it's common for messages to be already deleted
      if (!error.message?.includes('message to delete not found')) {
        this.logger.debug('Message deletion failed (likely already deleted):', error.message);
      }
      return false;
    }
  }

  /**
   * Edit message markup only
   */
  static async editMessageMarkup(
    ctx: Context,
    keyboard: InlineKeyboardMarkup
  ): Promise<boolean> {
    try {
      await ctx.editMessageReplyMarkup(keyboard);
      return true;
    } catch (error: any) {
      return await this.handleEditMarkupError(ctx, keyboard, error);
    }
  }

  /**
   * Send temporary message that auto-deletes
   */
  static async sendTemporaryMessage(
    ctx: Context,
    text: string,
    deleteAfterMs = 5000,
    options: MessageOptions = {}
  ): Promise<void> {
    try {
      const message = await ctx.reply(text, {
        parse_mode: 'HTML',
        ...options
      });

      // Auto-delete after specified time
      setTimeout(() => {
        this.safeDeleteMessage(ctx, message.message_id);
      }, deleteAfterMs);
    } catch (error) {
      this.logger.error('Error sending temporary message:', error);
    }
  }

  /**
   * Send typing indicator
   */
  static async sendTyping(ctx: Context): Promise<void> {
    try {
      await ctx.sendChatAction('typing');
    } catch (error) {
      // Ignore typing action errors
      this.logger.debug('Error sending typing action:', error);
    }
  }

  /**
   * Send long message with pagination support
   */
  static async sendLongMessage(
    ctx: Context,
    text: string,
    maxLength = 4000,
    options: MessageOptions = {}
  ): Promise<boolean> {
    if (text.length <= maxLength) {
      return await this.editOrReply(ctx, text, options);
    }

    // Split message into chunks
    const chunks = this.splitMessage(text, maxLength);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkOptions = i === 0 ? options : { parse_mode: options.parse_mode };
      
      if (i === 0) {
        await this.editOrReply(ctx, chunk, chunkOptions);
      } else {
        await this.safeReply(ctx, chunk, chunkOptions);
      }
      
      // Small delay between messages
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return true;
  }

  /**
   * Send formatted error message
   */
  static async sendError(
    ctx: Context,
    errorMessage: string,
    showRetryButton = false
  ): Promise<boolean> {
    const text = `❌ <b>Error</b>\n\n${errorMessage}`;
    
    if (showRetryButton) {
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('🔄 Try Again', 'retry_action')
      ]);
      
      return await this.sendWithInlineKeyboard(ctx, text, keyboard.reply_markup);
    }
    
    return await this.editOrReply(ctx, text);
  }

  /**
   * Send success message
   */
  static async sendSuccess(
    ctx: Context,
    successMessage: string,
    autoDelete = false,
    deleteAfterMs = 3000
  ): Promise<boolean> {
    const text = `✅ <b>Success</b>\n\n${successMessage}`;
    
    if (autoDelete) {
      this.sendTemporaryMessage(ctx, text, deleteAfterMs);
      return true;
    }
    
    return await this.editOrReply(ctx, text);
  }

  /**
   * Send loading message
   */
  static async sendLoadingMessage(
    ctx: Context,
    loadingText = '⏳ Processing...'
  ): Promise<number | null> {
    try {
      const message = await ctx.reply(loadingText);
      return message.message_id;
    } catch (error) {
      this.logger.error('Error sending loading message:', error);
      return null;
    }
  }

  /**
   * Update loading message
   */
  static async updateLoadingMessage(
    ctx: Context,
    messageId: number,
    newText: string
  ): Promise<boolean> {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        messageId,
        undefined,
        newText,
        { parse_mode: 'HTML' }
      );
      return true;
    } catch (error) {
      this.logger.error('Error updating loading message:', error);
      return false;
    }
  }

  /**
   * Handle edit message errors consistently
   */
  private static async handleEditMessageError(
    ctx: Context,
    text: string,
    options: MessageOptions,
    error: any
  ): Promise<boolean> {
    // Message is not modified - this is okay
    if (error.message?.includes('message is not modified')) {
      return true;
    }

    // Message too old to edit - send new message
    if (error.message?.includes('message can\'t be edited')) {
      return await this.safeReply(ctx, text, options);
    }

    // Try without markup on error
    if (options.reply_markup && error.message?.includes('Bad Request')) {
      const fallbackOptions: MessageOptions = { ...options };
      delete (fallbackOptions as any).reply_markup;
      try {
        const editOptions: any = { ...fallbackOptions };
        if (editOptions.reply_markup && !('inline_keyboard' in editOptions.reply_markup)) {
          delete editOptions.reply_markup;
        }
        await ctx.editMessageText(text, editOptions);
        return true;
      } catch (fallbackError) {
        // If that also fails, send new message
        return await this.safeReply(ctx, text, fallbackOptions);
      }
    }

    this.logger.error('Error editing message:', error);
    
    // Last resort - try to send new message
    try {
      return await this.safeReply(ctx, text, options);
    } catch (replyError) {
      this.logger.error('Error sending fallback reply:', replyError);
      return false;
    }
  }

  /**
   * Handle edit markup errors
   */
  private static async handleEditMarkupError(
    ctx: Context,
    keyboard: InlineKeyboardMarkup,
    error: any
  ): Promise<boolean> {
    if (error.message?.includes('message is not modified')) {
      return true;
    }

    this.logger.error('Error editing message markup:', error);
    return false;
  }

  /**
   * Split long message into chunks preserving formatting
   */
  private static splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let currentChunk = '';

    const lines = text.split('\n');
    
    for (const line of lines) {
      // If adding this line would exceed the limit
      if (currentChunk.length + line.length + 1 > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = line;
        } else {
          // Single line is too long - force split
          const words = line.split(' ');
          let wordChunk = '';
          
          for (const word of words) {
            if (wordChunk.length + word.length + 1 > maxLength) {
              if (wordChunk) {
                chunks.push(wordChunk.trim());
                wordChunk = word;
              } else {
                // Single word is too long - truncate
                chunks.push(word.substring(0, maxLength - 3) + '...');
              }
            } else {
              wordChunk += (wordChunk ? ' ' : '') + word;
            }
          }
          
          if (wordChunk) {
            currentChunk = wordChunk;
          }
        }
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}