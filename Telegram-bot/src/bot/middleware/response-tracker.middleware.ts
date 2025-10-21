import { Middleware, Context } from 'telegraf';
import { botResponseMonitor } from '../../services/bot-response-monitor.service';

/**
 * Middleware to track bot response times
 */
export function responseTrackerMiddleware(): Middleware<Context> {
  return async (ctx, next) => {
    const startTime = Date.now();
    let command = 'unknown';
    let action = 'unknown';

    try {
      // Determine command/action type
      if (ctx.message && 'text' in ctx.message) {
        const text = ctx.message.text;
        if (text.startsWith('/')) {
          command = text.split(' ')[0].substring(1);
          action = 'command';
        } else {
          command = 'message';
          action = 'text';
        }
      } else if (ctx.callbackQuery) {
        const data = (ctx.callbackQuery as any).data || '';
        command = data.split('_')[0] || 'callback';
        action = 'button';
      } else if (ctx.inlineQuery) {
        command = 'inline_query';
        action = 'inline';
      }

      // Execute the handler
      await next();

      // Calculate response time
      const responseTime = Date.now() - startTime;

      // Track the response
      await botResponseMonitor.trackResponse({
        command,
        action,
        responseTime,
        userId: ctx.from?.id?.toString() || 'unknown',
        username: ctx.from?.username,
        success: true,
        metadata: {
          chatType: ctx.chat?.type,
          hasReplyMarkup: !!(ctx as any).reply_markup,
        },
      });
    } catch (error) {
      // Track failed response
      const responseTime = Date.now() - startTime;
      
      await botResponseMonitor.trackResponse({
        command,
        action,
        responseTime,
        userId: ctx.from?.id?.toString() || 'unknown',
        username: ctx.from?.username,
        success: false,
        error: (error as Error)?.message,
      });

      throw error; // Re-throw to let error handler deal with it
    }
  };
}
