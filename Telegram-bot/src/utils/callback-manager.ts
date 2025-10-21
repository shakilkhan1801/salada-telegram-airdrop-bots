import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../services/logger';

export interface CallbackData {
  action: string;
  timestamp: number;
  params?: Record<string, any>;
}

export class CallbackManager {
  private static readonly logger = Logger.getInstance();
  private static readonly CALLBACK_TIMEOUT = 15 * 60 * 1000; // 15 minutes

  /**
   * Create callback data with timestamp
   */
  static createCallbackData(action: string, params?: Record<string, any>): string {
    const data: CallbackData = {
      action,
      timestamp: Date.now(),
      params
    };
    
    // Encode to base64 to handle special characters and reduce length
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
    
    // Ensure callback data doesn't exceed Telegram's 64 byte limit
    if (encoded.length > 64) {
      // Fallback to simple format if too long
      return `${action}_${Date.now()}`;
    }
    
    return encoded;
  }

  /**
   * Parse and validate callback data
   */
  static parseCallbackData(callbackData: string): { action: string; params?: Record<string, any>; isValid: boolean; error?: string } {
    try {
      // Handle legacy format (action_timestamp)
      if (callbackData.includes('_') && !callbackData.includes('=')) {
        const parts = callbackData.split('_');
        const lastPart = parts[parts.length - 1];
        const timestamp = parseInt(lastPart);
        const seemsTimestamp = /^\d{12,}$/.test(lastPart);
        
        if (!isNaN(timestamp) && seemsTimestamp) {
          const action = parts.slice(0, -1).join('_');
          const isValid = (Date.now() - timestamp) < this.CALLBACK_TIMEOUT;
          return {
            action,
            isValid,
            error: isValid ? undefined : 'Callback expired'
          };
        }
        
        return {
          action: callbackData,
          isValid: true
        };
      }

      // Handle new base64 encoded format
      let data: CallbackData;
      try {
        const decoded = Buffer.from(callbackData, 'base64').toString('utf-8');
        data = JSON.parse(decoded);
      } catch {
        // Fallback to treating as simple action
        return {
          action: callbackData,
          isValid: true
        };
      }

      const isValid = (Date.now() - data.timestamp) < this.CALLBACK_TIMEOUT;
      
      return {
        action: data.action,
        params: data.params,
        isValid,
        error: isValid ? undefined : 'This action has expired. Please try again.'
      };

    } catch (error) {
      this.logger.error('Error parsing callback data:', error);
      return {
        action: callbackData,
        isValid: false,
        error: 'Invalid callback data'
      };
    }
  }

  /**
   * Handle callback with automatic validation and error handling
   */
  static async handleCallback(
    ctx: Context,
    handler: (action: string, params?: Record<string, any>) => Promise<void>
  ): Promise<void> {
    const callbackData = (ctx.callbackQuery as any)?.data as string;
    
    if (!callbackData) {
      await ctx.answerCbQuery('❌ Invalid request');
      return;
    }

    const parsed = this.parseCallbackData(callbackData);
    
    if (!parsed.isValid) {
      await ctx.answerCbQuery(parsed.error || '❌ Action expired');
      
      // Update message to show expired state
      try {
        if (ctx.callbackQuery?.message) {
          await ctx.editMessageReplyMarkup({
            inline_keyboard: [[
              { text: 'Refresh', callback_data: this.createCallbackData('admin_panel') }
            ]]
          });
        }
      } catch (error) {
        // Ignore edit errors (message might be too old)
        this.logger.debug('Could not update expired message:', error);
      }
      
      return;
    }

    try {
      // Answer callback query first to prevent timeout
      await ctx.answerCbQuery();
      
      // Execute the handler
      await handler(parsed.action, parsed.params);
      
    } catch (error: any) {
      this.logger.error('Error in callback handler:', error);
      
      // Handle specific Telegram API errors
      if (error.code === 400 && error.description?.includes('query is too old')) {
        // Don't try to answer an expired callback
        return;
      }
      
      try {
        await ctx.answerCbQuery('❌ Error processing request');
      } catch {
        // Ignore if we can't answer the callback
      }
    }
  }

  /**
   * Create keyboard with time-stamped callback data
   */
  static createKeyboard(buttons: { text: string; action: string; params?: any }[][]): InlineKeyboardMarkup {
    return {
      inline_keyboard: buttons.map(row =>
        row.map(button => ({
          text: button.text,
          callback_data: this.createCallbackData(button.action, button.params)
        }))
      )
    };
  }

  /**
   * Remove keyboard after callback is handled
   */
  static async removeKeyboard(ctx: Context, newText?: string): Promise<void> {
    try {
      if (newText) {
        await ctx.editMessageText(newText, {
          reply_markup: { inline_keyboard: [] },
          parse_mode: 'HTML'
        });
      } else {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      }
    } catch (error) {
      // Ignore edit errors (message might be too old or already edited)
      this.logger.debug('Could not remove keyboard:', error);
    }
  }

  /**
   * Update keyboard with new callback data (refresh timestamps)
   */
  static async updateKeyboard(ctx: Context, keyboard: InlineKeyboardMarkup): Promise<void> {
    try {
      await ctx.editMessageReplyMarkup(keyboard);
    } catch (error) {
      this.logger.debug('Could not update keyboard:', error);
    }
  }
}