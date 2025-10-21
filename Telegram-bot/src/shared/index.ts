/**
 * Shared utilities and services to eliminate code duplication
 * across all bot handlers
 * 
 * This module exports all the common functionality that was previously
 * duplicated 60-80% across different handlers.
 */

// Services
export { UserValidationService } from './services/user-validation.service';
export { CallbackQueryService, ActionSession } from './services/callback-query.service';
export { MessageService } from './services/message.service';
export { RateLimitService, RateLimitAction } from './services/rate-limit.service';
export { 
  PointsService, 
  PointTransactionType, 
  PointEarningCategory 
} from './services/points.service';
export { 
  LeaderboardService, 
  LeaderboardType,
  type LeaderboardEntry 
} from './services/leaderboard.service';

// Utilities
export { DateUtils } from './utils/date.utils';

/**
 * Common usage patterns:
 * 
 * 1. User Validation:
 *    const user = await UserValidationService.validateUser(ctx);
 *    if (!user) return; // Error already handled
 * 
 * 2. Callback Handling:
 *    await CallbackQueryService.handleCallbackWithTimeout(ctx, async (ctx) => {
 *      // Your callback logic here
 *    });
 *
 * 2b. Session-based Callback (for timeout-sensitive actions):
 *    const sessionId = CallbackQueryService.createActionSession(userId, 'action_name');
 *    // Use sessionId in callback_data
 *    await CallbackQueryService.handleCallbackWithSession(ctx, sessionId, async (ctx, session) => {
 *      // Your session-based logic here
 *    });
 * 
 * 3. Message Management:
 *    await MessageService.editOrReply(ctx, text, { reply_markup: keyboard });
 * 
 * 4. Rate Limiting:
 *    if (!(await RateLimitService.checkAndEnforce(ctx, RateLimitAction.TASK_SUBMISSION))) {
 *      return; // Rate limit message already sent
 *    }
 * 
 * 5. Points Management:
 *    const result = await PointsService.awardPoints(
 *      userId, 
 *      100, 
 *      'Task completed',
 *      PointEarningCategory.TASK_COMPLETION
 *    );
 * 
 * 6. Date Handling:
 *    const joinDate = DateUtils.parseUserJoinDate(user);
 *    const daysSince = DateUtils.calculateDaysSince(joinDate);
 * 
 * 7. Leaderboard Generation:
 *    const leaderboard = await LeaderboardService.generatePointsLeaderboard(10);
 *    const formattedText = LeaderboardService.formatLeaderboardText(
 *      leaderboard, 
 *      '🏆 Top Users'
 *    );
 */