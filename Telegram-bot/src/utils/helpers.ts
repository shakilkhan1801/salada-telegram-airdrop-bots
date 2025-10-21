/**
 * Helper functions for the Telegram bot
 * Converted from JavaScript to TypeScript and updated to use unified validation service
 */

import { safeRegex } from '../services/validation.service';

export interface User {
  walletAddress?: string;
  [key: string]: any;
}

export interface Task {
  name: string;
  reward?: number;
  enabled: boolean;
  [key: string]: any;
}

export interface TasksCompleted {
  [taskId: string]: boolean;
}

export interface AllTasks {
  [taskId: string]: Task;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/**
 * Helper functions for task validation and utility operations
 */
export const helpers = {
  /**
   * Format a message with dynamic values
   * @param messageTemplate - Message template with placeholders
   * @param values - Values to replace placeholders
   * @returns Formatted message
   */
  formatMessage: (messageTemplate: string, values: Record<string, any>): string => {
    // Check if messageTemplate is valid
    if (!messageTemplate || typeof messageTemplate !== 'string') {
      console.error('formatMessage: Invalid messageTemplate provided:', messageTemplate);
      return 'Message template not found';
    }

    // Check if values object is valid
    if (!values || typeof values !== 'object') {
      console.error('formatMessage: Invalid values object provided:', values);
      return messageTemplate;
    }

    let message = messageTemplate;

    // Replace all placeholders with their values
    Object.keys(values).forEach((key) => {
      const placeholder = `{${key}}`;
      const value = values[key];
      
      // Escape regex special characters in placeholder for safe replacement
      const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const safeRegexResult = safeRegex(escapedPlaceholder, 'g');
      
      if (!safeRegexResult) {
        console.error(`formatMessage: Invalid placeholder pattern for key '${key}'`);
        return;
      }
      
      // Only replace if value is not null or undefined
      if (value !== null && value !== undefined) {
        message = message.replace(safeRegexResult, String(value));
      } else {
        console.warn(`formatMessage: Value for key '${key}' is null or undefined`);
        // Replace with empty string
        message = message.replace(safeRegexResult, '');
      }
    });

    return message;
  },

  /**
   * Get keyboard markup for main menu (Professional UI)
   * @param ctx - Telegram context object
   * @param user - User data object (optional)
   * @returns Inline keyboard markup
   */
  getMainMenuKeyboard: (ctx: any, user: User | null = null): InlineKeyboardMarkup => {
    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [{ text: "📋 Tasks & Missions", callback_data: "tasks_menu" }, { text: "👥 My Referrals", callback_data: "my_referrals" }], // Row 1: Tasks | My Referrals
        [{ text: "🎁 Rewards", callback_data: "withdraw" }, { text: "📊 Claim Stats", callback_data: "public_claim_stats" }], // Row 2: Withdraw | Claim Stats
      ]
    };
    
    // Add wallet status row - only show disconnect and claim if wallet is connected
    if (user && user.walletAddress) {
      keyboard.inline_keyboard.push([
        { text: "🔌 Disconnect Wallet", callback_data: "disconnect_wallet" },
        { text: "🪙 Claim Tokens", callback_data: "claim_airdrop" }
      ]);
    }
    
    // Add feedback row
    keyboard.inline_keyboard.push([{ text: "💬 Feedback", callback_data: "send_feedback_prompt" }]);
    
    // Add admin panel button if user is admin
    return keyboard;
  },

  /**
   * Get the inline keyboard for the user's tasks menu.
   * @param tasksCompleted - Object mapping completed task IDs to true.
   * @param allTasks - All available tasks (passed as parameter to avoid circular dependency)
   * @returns Inline keyboard markup.
   */
  getTasksMenuKeyboard: (tasksCompleted: TasksCompleted | null, allTasks: AllTasks | null = null): InlineKeyboardMarkup => {
    console.log("Inside getTasksMenuKeyboard.");
    
    if (!allTasks) {
      console.warn('getTasksMenuKeyboard: No tasks provided');
      return { inline_keyboard: [] };
    }
    
    const buttons: InlineKeyboardButton[][] = [];
    let currentRow: InlineKeyboardButton[] = [];
    const buttonsPerRow = 1; // Changed to 1 for better readability with longer text
  
    for (const taskId in allTasks) {
        if (allTasks.hasOwnProperty(taskId)) {
            const task = allTasks[taskId];
            
            if (task.enabled === true) {
                const isCompleted = tasksCompleted && tasksCompleted[taskId];
                const rewardAmount = task.reward || 0;
                
                // Enhanced button text with status and reward
                let buttonText: string;
                if (isCompleted) {
                    buttonText = `✅ ${task.name} - COMPLETED (${rewardAmount}🪙)`;
                } else {
                    buttonText = `⏳ ${task.name} - Earn ${rewardAmount}🪙`;
                }
                
                currentRow.push({ 
                    text: buttonText, 
                    callback_data: `task_${taskId}` 
                });
  
                if (currentRow.length === buttonsPerRow) {
                    buttons.push(currentRow);
                    currentRow = [];
                }
            }
        }
    }
  
    if (currentRow.length > 0) {
        buttons.push(currentRow);
    }
  
    // Add back button
    buttons.push([{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]);
  
    return { inline_keyboard: buttons };
  },

  /**
   * Get keyboard markup for back to tasks button (Professional UI)
   * @returns Inline keyboard markup
   */
  getTasksBackKeyboard: (): InlineKeyboardMarkup => {
    return {
      inline_keyboard: [
        [{ text: "⬅️ Back to Tasks Menu", callback_data: "tasks_menu" }],
      ],
    };
  },

  /**
   * Calculate age bonus points based on Telegram User ID
   * @param userId - Telegram user ID
   * @returns Points earned from age bonus
   */
  calculateAgeBonus: (userId: string): number => {
    try {
      const id = parseInt(userId, 10);
      if (isNaN(id)) {
        console.error("Invalid user ID for age bonus calculation:", userId);
        return 0;
      }

      if (id < 10000000) {
        return 100;
      } else if (id <= 100000000) {
        return 75;
      } else if (id <= 1000000000) {
        return 50;
      } else if (id <= 2000000000) {
        return 35;
      } else {
        return 10;
      }
    } catch (error) {
      console.error("Error calculating age bonus based on user ID:", error);
      return 0;
    }
  },

  /**
   * Validate Twitter URL format
   * @param url - URL to validate
   * @returns Whether URL is valid Twitter URL
   */
  isValidTwitterUrl: (url: string): boolean => {
    return typeof url === "string" && url.includes("twitter.com") && url.includes("/status/");
  },

  /**
   * Extract start parameter from deep link
   * @param startParam - Start parameter from deep link
   * @returns Referral code or null if invalid
   */
  extractReferralCode: (startParam: string): string | null => {
    if (!startParam || typeof startParam !== "string") return null;

    // If the start parameter is a valid user ID (numeric), use it as referral code
    const userId = parseInt(startParam, 10);
    if (!isNaN(userId)) {
      return startParam;
    }

    return null;
  },
};

export default helpers;