/**
 * Message Manager
 * Converted from JavaScript to TypeScript and updated to use unified validation service
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeRegex } from '../services/validation.service';

const dataLoader = require('./dataLoader');

export interface DefaultMessages {
  [key: string]: string;
}

export interface MessageReplacements {
  [key: string]: string | number;
}

export interface FileStatus {
  exists: boolean;
  valid: boolean;
  reason: string;
  path: string;
}

export interface ValidationResult {
  valid: boolean;
  reason: string;
}

export class MessageManager {
  private messagesPath: string;
  private defaultMessages: DefaultMessages;

  constructor() {
    const DATA_DIR = path.join(__dirname, '..', 'data');
    this.messagesPath = path.join(DATA_DIR, 'messages.json');
    
    // Professional and concise message definitions
    this.defaultMessages = {
      "WELCOME": "**Shakil Token Distribution Platform**\n\nAccess premium token rewards through verified task completion and referral participation.\n\n**Account Status:**\n• Current Balance: {points} Tokens\n• Referral Link: `{referralLink}`\n\nProceed to task center below.",
      "TASKS_MENU": "**Task Center**\n\nGreetings {username}. Complete verified tasks to earn tokens.\n\n**Available Opportunities:**\n• Social Media Verification\n• Community Engagement\n• Referral Program: {referralBonus} tokens per verified invite\n\n**Withdrawal Requirements:**\n• Minimum: {minWithdraw} tokens\n• Active channel membership required\n\nSelect task to proceed.",
      "TASK_COMPLETED": "✅ Task verified. {points} tokens credited.",
      "ALREADY_COMPLETED": "✅ Task previously completed.",
      "INELIGIBLE_WITHDRAW": "**Withdrawal Requirements Not Met**\n\n• Additional {pointsNeeded} tokens required\n• Channel membership verification required",
      "WALLET_CONNECT_SUCCESS": "**Wallet Connection Established**\n\nToken claiming now available.",
      "MAINTENANCE_MODE": "⚠️ System maintenance in progress. Service temporarily unavailable.",
      "CHANNEL_JOIN_REQUIRED": "Channel membership verification required to proceed.",
      "INVALID_REFERRAL": "Invalid referral code provided.",
      "REFERRAL_SUCCESS": "**Referral Verified**\n\nReferred by {referrer}. Bonus tokens awarded.",
      "DAILY_LIMIT_REACHED": "Daily limit reached. Service resets at 00:00 UTC.",
      "INSUFFICIENT_POINTS": "Insufficient balance. Minimum required: {minPoints} tokens.",
      "ERROR_OCCURRED": "System error encountered. Please retry.",
      "BOT_OFFLINE": "Service temporarily unavailable.",
      "FEATURE_DISABLED": "Feature temporarily disabled.",
    
      // Wallet related messages
      "USER_NOT_FOUND": "User not found. Please restart the bot with /start",
      "WALLET_ALREADY_SET": "You already have a wallet connected!",
      "WALLET_CONNECT_FAILED": "❌ Wallet connection failed. Please try again.",
      "WALLET_NOT_SET": "Please connect your wallet first.",
      "WALLET_EXPIRED": "Your wallet connection has expired. Please reconnect your wallet.",
      "WALLET_DISCONNECT_SUCCESS": "🔌 Wallet disconnected successfully.\n\nThis disconnection was initiated from the bot.\n\nYou can connect a new wallet anytime to claim your tokens.",
      "WALLET_DISCONNECT_FAILED": "❌ Failed to disconnect wallet. Please try again.",
      "WALLET_NOT_CONNECTED": "❌ No wallet connected to disconnect.",
      "WALLET_DISCONNECTED_FROM_APP": "🔌 Your wallet has been disconnected.\n\nThis disconnection was initiated from your wallet app.\n\nYou can connect a new wallet anytime to claim your tokens.",
    
      // QR Code messages
      "QR_ACTIVE": "You have an active QR code!",
      "QR_LIMIT_REACHED": "Daily QR code generation limit reached!",
      "QR_EXPIRED": "❌ QR code has expired. Please generate a new QR code to connect your wallet.",
      "QR_CAPTION": "📱 Scan this QR code with your wallet app to connect.\n\nThis will help you claim {points} {tokenSymbol} tokens.\n\nAfter connecting your wallet, click \"Claim Airdrop Token\" to receive your tokens.",
      "GENERATING_QR": "Generating QR code...",
    
      // Transaction messages
      "TRANSACTION_PROCESSING": "🔄 Processing your claim request. This may take a few moments...",
      "TRANSACTION_FAILED": "❌ Transaction failed. Please try again.",
      "TRANSACTION_CANCELLED": "❌ Transaction request cancelled.\n\nYou can try again anytime when you're ready to claim your tokens.",
      "TRANSACTION_REJECTED": "❌ Transaction request was not sent or was rejected by the wallet.",
      "PROCESSING_CLAIM": "Processing claim request...",
      "CONFIRM_IN_WALLET": "Please confirm the transaction in your wallet...",
      "CHECKING_TX_STATUS": "Checking transaction status...",
      "NO_TX_TO_CHECK": "No transaction found to check.",
    
      // Claim messages
      "CLAIM_SUCCESS": "🎉 Congratulations! Your tokens have been successfully claimed!",
      "CLAIM_FAILED": "❌ Claim failed. Please try again.",
      "INSUFFICIENT_BALANCE": "You don't have enough points to claim tokens. You need at least {minPoints} points.",
      "ALREADY_CLAIMED": "✅ Already Claimed",
      "ELIGIBLE_TO_CLAIM": "✅ Eligible",
    
      // Wallet address messages
      "SUBMIT_WALLET_ADDRESS": "📝 Please send your Ethereum wallet address.\n\nMake sure it's a valid Ethereum address starting with 0x.",
      "INVALID_WALLET_ADDRESS": "❌ Invalid wallet address. Please send a valid Ethereum address starting with 0x.",
      "SUBMIT_TX_HASH": "📝 Please send your transaction hash.\n\nMake sure it's a valid Ethereum transaction hash starting with 0x.",
      "INVALID_TX_HASH": "❌ Invalid transaction hash. Please send a valid Ethereum transaction hash starting with 0x.",
    
      // Task messages
      "TASK_ALREADY_COMPLETED": "You've already received points for this task or an error occurred. ✅",
      "TASK_VERIFICATION_FAILED": "❌ Task verification failed! Please make sure you've completed all requirements and try again.",
      "TASK_CONFIG_INCOMPLETE": "Error: Task configuration is incomplete. Please contact admin.",
      "PROCESSING_SUBMISSION": "Processing your submission...",
      "TWITTER_FOLLOW_SUCCESS": "Twitter follow task completed successfully!",
      "RETWEET_SUCCESS": "Retweet task completed successfully!",
      "MEDIUM_FOLLOW_SUCCESS": "Medium follow task completed successfully!",
      "INSTAGRAM_FOLLOW_SUCCESS": "Instagram follow task completed successfully!",
      "YOUTUBE_SUBSCRIBE_SUCCESS": "YouTube subscription verified successfully!",
      "LINKEDIN_FOLLOW_SUCCESS": "LinkedIn follow task completed successfully!",
      "INVALID_TWITTER_URL": "Please provide a valid Twitter profile link starting with https://twitter.com/ or https://x.com/",
      "INVALID_RETWEET_URL": "Please provide a valid retweet link starting with https://twitter.com/ or https://x.com/ and containing /status/",
      "INVALID_MEDIUM_URL": "Please provide a valid Medium profile link starting with https://medium.com/@",
      "INVALID_INSTAGRAM_URL": "Please provide a valid Instagram profile link starting with https://instagram.com/",
      "INVALID_YOUTUBE_URL": "Please provide a valid YouTube channel link starting with https://youtube.com/@",
      "INVALID_LINKEDIN_URL": "Please provide a valid LinkedIn profile or company link",
    
      // Feedback messages
      "FEEDBACK_PROMPT": "📝 *Send Feedback*\n\nPlease type your message below. It will be sent directly to the bot administrators.\n\n---\n👇 Tap back to cancel.",
      "FEEDBACK_ERROR": "❌ An error occurred while sending your feedback. Please try again later.",
    
      // Captcha messages
      "CAPTCHA_INCORRECT": "❌ Incorrect captcha. Please try again with /start",
    
      // General status messages
      "WALLET_STATUS_NOT_CONNECTED": "Not Connected",
      "LOADING_STATS": "An error occurred while loading claim statistics.",
      "UNEXPECTED_ERROR": "❌ An unexpected error occurred. Please try again or contact support.",
      "INVALID_REQUEST": "Invalid request. Please restart the bot with /start",
    
      // Network and blockchain errors
      "NETWORK_ERROR": "❌ Network error occurred. Please try again.",
      "BLOCKCHAIN_ERROR": "❌ Blockchain error occurred. Please try again.",
      "NONCE_ERROR": "Failed to get nonce from blockchain. Please try again.",
      "SIGNATURE_ERROR": "Failed to generate signature. Please try again.",
      "CONTRACT_ERROR": "Failed to create contract interface. Please try again.",
      "ENCODE_ERROR": "Failed to encode transaction data. Please try again.",
      "SESSION_ERROR": "Failed to get wallet sessions. Please reconnect your wallet.",
      "WALLET_INIT_ERROR": "Failed to initialize wallet connection. Please try again.",
      "NO_ACTIVE_CONNECTION": "No active wallet connection found. Please reconnect your wallet.",

      "TASK_ALREADY_COMPLETED_GENERIC": "You have already completed the {taskName} task. ✅",
      "TASK_NOT_FOUND": "Task not found.",
      "SUBMIT_LINK_PROMPT": "Please submit the required link to verify this task.",
      "JOIN_CHANNEL_PROMPT": "Please join our channel: {chatId}\n\nAfter joining, click the verify button below.",
      "VERIFY_PREMIUM_PROMPT": "Click the button below to verify your Telegram Premium status.",
      "COMPLETE_TASK_PROMPT": "Click the button below to complete this task.",
      "SUBMIT_LINK_INSTRUCTIONS": "📝 <b>{taskName}</b>\n\n{instructions}\n\n⚠️ Send the link as a message (not as a reply to this message).",
      "VERIFYING_TASK": "Verifying task completion...",
      "SUBMIT_LINK_BUTTON_PROMPT": "Please submit your link using the 'Submit Link' button.",
      "USER_ID_BONUS_FAILED": "❌ User ID Bonus Task Failed!\n\nYour Telegram User ID ({userId}) is not eligible for this bonus.\n\nThis task is only available for specific User ID ranges. Unfortunately, your ID doesn't fall within the qualifying range for this reward.",
      "PREMIUM_STATUS_FAILED": "❌ Premium Status Required!\n\nThis task requires Telegram Premium membership. Please upgrade to Telegram Premium and try again.",
      "CHANNEL_MEMBERSHIP_FAILED": "❌ Channel Membership Required!\n\nYou must join the required channel/group to complete this task. Please join and try again.",
      "TASK_COMPLETED_GENERIC": "✅ Task completed successfully!\n\nYou've earned {reward} Tokens for completing {taskName}.",
      "SUBMISSION_PROCESSING_ERROR": "An error occurred while processing your submission. Please try again.",

      // Menu handler messages
      "CAPTCHA_WELCOME_NEW": "❇️ Welcome! Please enter the captcha to get started:",
      "CAPTCHA_WELCOME_EXISTING": "❇️ Please enter the captcha to continue:",
      "FEEDBACK_SUCCESS": "✅ Your feedback has been sent to the administrators. Thank you for your input!",
      "MAIN_DASHBOARD": "🎯 **MAIN DASHBOARD**\n\n💰 **Balance:** {points} Tokens\n{walletIcon} **Wallet:** {walletStatus}\n🔗 **Referral Link:** `{referralLink}`\n\n━━━━━━━━━━━━━━━━━━━━━━━\n📋 **Quick Actions Available Below** 👇",
      "WALLET_CONNECTED": "{walletAddress}",
      "TOKEN_DASHBOARD": "**TOKEN OVERVIEW**\n\n**Balance:** {points} Tokens\n\n**Earnings Summary:**\n• {channelStatus} Channel: {channelPoints}\n• {twitterStatus} Twitter: {twitterPoints}\n• {retweetStatus} Retweet: {retweetPoints}\n• {premiumStatus} Premium: {premiumPoints}\n• {referralStatus} Referrals: {referralPoints} ({referralCount})\n\n**Withdrawal Status:**\n{statusIcon} {withdrawalStatus}{reason}\n\n*Requirements: {minWithdraw} tokens + active membership*",
      "NOT_ELIGIBLE_TO_CLAIM": "❌ Not Eligible",
      "POINTS_NEEDED": "You need {pointsNeeded} more Tokens",
      "CHANNEL_MEMBERSHIP_REQUIRED": "You must be a member of {channelId} channel",
      "PUBLIC_CLAIM_STATS": "📊 *Public Claim Statistics*\n\n👥 *Total Users:* {totalUsers}\n💰 *Total Claims Processed:* {totalClaims}\n🪙 *Total Points Claimed:* {totalPointsClaimed} {tokenSymbol}\n\n{lastClaimInfo}\n\n_Statistics updated in real-time_",
      "LAST_CLAIM_INFO": "🕐 *Last Claim Info:*\n📅 Date: {date}\n💎 Points: {points} {tokenSymbol}\n🔗 Tx Hash: `{txHash}`",
      "NO_CLAIMS_YET": "🕐 *Last Claim:* No claims yet",
      "STATS_UP_TO_DATE": "Statistics are already up to date! 📊",
      "LOADING_STATS_ERROR": "An error occurred while loading claim statistics.",
      "GENERIC_ERROR": "An error occurred. Please try again.",
      "PROCESSING_WAIT": "Please wait, your previous action is still being processed.",

      // Referral handler messages
      "REFERRAL_DASHBOARD": "**REFERRAL PROGRAM**\n\n**Your Referral Link:**\n`{referralLink}`\n\n**Program Details:**\nEarn {pointsPerReferral} Tokens per verified referral.\n\n**Performance Metrics:**\n• Total Referrals: {referralCount}\n• Tokens Earned: {referralPoints}\n• Earning Potential: Unlimited\n\n**COMPLIANCE NOTICE**\n\n**Prohibited Activities:**\n• Fake account creation\n• Automated referrals\n• Self-referrals\n• Fraudulent activities\n\n**Consequences:**\n• Account suspension\n• Token forfeiture\n• No appeal process\n• IP blocking\n\n**Only genuine users permitted**\n**All referrals verified**",

      // Wallet handler messages
      "QR_EXPIRED_NOTIFICATION": "🚨 **QR CODE EXPIRED** 🚨\n\n┌─────────────────────────────────┐\n│        **EXPIRY DETAILS**       \n├─────────────────────────────────┤\n│ ⏰ **Expired At:**              \n│    {expiredAt} (UTC)           \n{walletStatus}└─────────────────────────────────┘\n\n📋 **NEXT STEPS**\n\n┌─────────────────────────────────┐\n│ ✅ Generate a new QR code       \n│ 🔢 Remaining generations: **{remainingGenerations}**   \n│ 📅 Resets daily at midnight UTC \n└─────────────────────────────────┘\n\n💡 *Tip: QR codes expire after 10 minutes for security*",
      "WALLET_STATUS_EXPIRED": "│                                 \n│ 🔌 **Status:**                  \n│    Wallet Automatically         \n│    Disconnected                 \n",
      "WITHDRAWAL_NOTIFICATION": "\n🚨 *WITHDRAWAL ALERT* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *User Details:*\n┣ *First Name:* {firstName}\n┗ *User ID:* `{userId}`\n\n💰 *Withdrawal Info:*\n┣ *Token Claimed:* {tokensFormatted} {tokenSymbol}\n┣ *Wallet Address:* `{walletAddress}`\n┣ *Transaction Hash:* `{txHash}`\n┗ *Timestamp:* {timestamp} UTC\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ *Status:* Withdrawal Processed Successfully\n",

      // Additional wallet messages
      "NEW_POINTS_AVAILABLE": "🎉 You have {availablePoints} Tokens available to claim!\n\nConnected Wallet: `{walletAddress}`\n\nWould you like to:",
      "POINTS_AVAILABLE": "You have {availablePoints} points available to claim.\n\nConnected Wallet: `{walletAddress}`\n\nWould you like to:",
      "CLAIM_ELIGIBLE": "🎉 **CONGRATULATIONS!**\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n✅ You've earned **{points} tokens** and are eligible to claim!\n\n📋 **QR CODE RULES & LIMITS:**\n┌─────────────────────────────────┐\n│ 🔢 Daily Limit: {dailyQrLimit} QR generations max    \n│ ⏰ Expiry Time: {qrExpiry} minutes per code      \n│ 🚫 No new QR until current expires \n│ 🔌 Auto-disconnect on expiry       \n└─────────────────────────────────┘\n\n💰 **CLAIM YOUR TOKENS:**\nChoose your preferred method below:\n\n🔸 **Method 1:** Scan QR with wallet app\n🔸 **Method 2:** Download & scan QR (Mobile users)\n   ▫️ Step 1: Download QR code image\n   ▫️ Step 2: Open Bitget Wallet app\n   ▫️ Step 3: Tap QR scan on home page top\n   ▫️ Step 4: Select \"Album\" → Choose downloaded QR",
      "QR_CODE_DETAILS": "See the QR code above. Or use this URI with WalletConnect:\n\n[Connect using WalletConnect]({uri})\n\n⏰ **QR Code Details:**\n• Generated: {generatedAt} (UTC)\n• Expires: {expiresAt} (UTC)\n• Valid for: {qrExpiryMinutes} minutes",
      "WALLET_CONNECTION_EXPIRED": "❌ QR code has expired. Please generate a new QR code to connect your wallet.",
      "PROPOSAL_EXPIRED": "🚫 **Connection Request Expired**\n\n┌─────────────────────────────────┐\n│  The QR code has expired       │\n│  Please generate a new one     │\n└─────────────────────────────────┘\n\n💡 **What happened?**\n• QR codes expire after {qrExpiryMinutes} minutes for security\n• This prevents unauthorized access\n\n✨ *Ready to try again? Just tap below!*",
      "ENCODE_DATA_ERROR": "Failed to encode transaction data. Please try again.",

      // Additional transaction and claim messages
      "SESSION_ERROR_DETAILED": "Failed to get wallet sessions. Please reconnect your wallet.",
      "NO_ACTIVE_CONNECTION_DETAILED": "No active wallet connection found. Please reconnect your wallet.",
      "TRANSACTION_FALLBACK_ERROR": "❌ Transaction failed. Please try again.",
      "CLAIM_SUCCESS_DETAILED": "✅ Claim transaction confirmed successfully!\n\nTransaction Hash: `{txHash}`\n\n{pointsClaimed} tokens have been sent to your wallet.\n\nYou can continue earning points and claim them when you reach the minimum withdrawal amount.",
      "TRANSACTION_FAILED_DETAILED": "❌ Claim transaction failed. Please check the transaction on the block explorer.\n\nTransaction Hash: `{txHash}`",
      "TRANSACTION_TIMEOUT": "⏳ Transaction submitted but confirmation is taking longer than expected.\n\nTransaction Hash: `{txHash}`\n\nPlease check the transaction status on the block explorer.",
      "TRANSACTION_REJECTED_DETAILED": "❌ Transaction request was not sent or was rejected by the wallet.",
      "UNEXPECTED_ERROR_DETAILED": "❌ An unexpected error occurred. Please try again or contact support.",
      "CALLBACK_QUERY_ERROR": "An error occurred",
      "WALLET_DISCONNECT_ERROR": "An error occurred while disconnecting wallet. Please try again.",
      "WALLET_ADDRESS_PROMPT": "📝 Please send your Ethereum wallet address.\n\nMake sure it's a valid Ethereum address starting with 0x.",
      "TX_HASH_PROMPT": "📝 Please send your transaction hash.\n\nMake sure it's a valid Ethereum transaction hash starting with 0x."
    };
    
    // Initialize with dataLoader
    this.initializeDataLoader();
  }

  /**
   * Initialize dataLoader for messages
   */
  private initializeDataLoader(): void {
    // Message validator function
    const messageValidator = (data: any) => {
      if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Data must be an object' };
      }
      
      // Check if it has at least some essential keys
      const essentialKeys = ['WELCOME', 'TASKS_MENU', 'TASK_COMPLETED'];
      const hasEssentialKeys = essentialKeys.some(key => data.hasOwnProperty(key));
      
      if (!hasEssentialKeys) {
        return { valid: false, error: 'Missing essential message keys' };
      }
      
      return { valid: true };
    };

    // Register messages data source
    dataLoader.registerDataSource(
      'messages',
      this.messagesPath,
      messageValidator,
      () => ({ ...this.defaultMessages }), // Fallback function
      {
        autoCreate: true,
        watchFile: true
      }
    );

    // Set up event listeners
    dataLoader.on('dataLoaded', (key: string, data: any) => {
      if (key === 'messages') {
        console.log('✅ [MessageManager] Messages loaded successfully');
      }
    });

    dataLoader.on('dataChanged', (key: string, data: any) => {
      if (key === 'messages') {
        console.log('🔄 [MessageManager] Messages updated from file');
      }
    });
  }

  /**
   * Get messages from cache
   * @returns Messages object
   */
  getMessages(): DefaultMessages {
    const messages = dataLoader.getData('messages');
    // Merge with defaults to ensure all keys exist
    return { ...this.defaultMessages, ...messages };
  }

  /**
   * Legacy loadMessages method for backward compatibility
   * @deprecated Use getMessages() instead
   */
  loadMessages(): DefaultMessages {
    return this.getMessages();
  }

  getMessage(key: string, replacements: MessageReplacements = {}): string {
    const messages = this.getMessages();
    let message = messages[key];
    
    // If not found, try default messages
    if (!message) {
      message = this.defaultMessages[key];
      console.warn(`⚠️ [MessageManager] Message key '${key}' not found, using default`);
    }
    
    // If still not found, return the key itself as fallback
    if (!message) {
      console.error(`❌ [MessageManager] Message key '${key}' not found in default messages either`);
      return key;
    }
    
    // Replace placeholders with actual values
    Object.keys(replacements).forEach(placeholder => {
      // Escape regex special characters in placeholder for safe replacement
      const escapedPlaceholder = `{${placeholder}}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const safeRegexResult = safeRegex(escapedPlaceholder, 'g');
      
      if (safeRegexResult) {
        message = message.replace(safeRegexResult, String(replacements[placeholder]));
      } else {
        console.error(`messageManager: Invalid placeholder pattern '${placeholder}'`);
      }
    });
    
    return message;
  }

  /**
   * Get all messages (merged with defaults)
   * @returns All messages
   */
  getAllMessages(): DefaultMessages {
    return this.getMessages();
  }

  /**
   * Get default messages
   * @returns Default messages
   */
  getDefaultMessages(): DefaultMessages {
    return { ...this.defaultMessages };
  }

  /**
   * Update a message in the data source
   * @param key - Message key
   * @param value - New message value
   * @returns Success status
   */
  async updateMessage(key: string, value: string): Promise<boolean> {
    return await dataLoader.updateData('messages', (data: DefaultMessages) => {
      data[key] = value;
      return data;
    });
  }

  /**
   * Add multiple messages
   * @param messages - Messages to add
   * @returns Success status
   */
  async addMessages(messages: DefaultMessages): Promise<boolean> {
    return await dataLoader.updateData('messages', (data: DefaultMessages) => {
      return { ...data, ...messages };
    });
  }

  /**
   * Remove a message
   * @param key - Message key to remove
   * @returns Success status
   */
  async removeMessage(key: string): Promise<boolean> {
    return await dataLoader.updateData('messages', (data: DefaultMessages) => {
      delete data[key];
      return data;
    });
  }

  /**
   * Refresh messages from file
   * @returns Refreshed messages
   */
  async refreshMessages(): Promise<DefaultMessages> {
    return await dataLoader.refreshData('messages');
  }

  /**
   * Get file status information
   * @returns File status info
   */
  getFileStatus(): FileStatus {
    try {
      const exists = fs.existsSync(this.messagesPath);
      let valid = false;
      let reason = '';
      
      if (exists) {
        try {
          const content = fs.readFileSync(this.messagesPath, 'utf8');
          const data = JSON.parse(content);
          valid = typeof data === 'object' && data !== null;
          reason = valid ? 'File is valid' : 'File content is not a valid object';
        } catch (parseError: any) {
          valid = false;
          reason = `JSON parse error: ${parseError.message}`;
        }
      } else {
        reason = 'File does not exist';
      }
      
      return {
        exists,
        valid,
        reason,
        path: this.messagesPath
      };
    } catch (error: any) {
      return {
        exists: false,
        valid: false,
        reason: `Error checking file: ${error.message}`,
        path: this.messagesPath
      };
    }
  }

  /**
   * Reset messages to default
   * @returns Success status
   */
  resetToDefault(): boolean {
    try {
      fs.writeFileSync(this.messagesPath, JSON.stringify(this.defaultMessages, null, 2));
      // Force reload from dataLoader
      dataLoader.refreshData('messages');
      return true;
    } catch (error) {
      console.error('Error resetting to default:', error);
      return false;
    }
  }

  /**
   * Validate messages file
   * @returns Validation result
   */
  validateMessagesFile(): ValidationResult {
    const status = this.getFileStatus();
    return {
      valid: status.exists && status.valid,
      reason: status.reason
    };
  }

  /**
   * Reload messages from file
   * @returns Reloaded messages
   */
  reloadMessages(): DefaultMessages {
    return dataLoader.refreshData('messages');
  }
}

// Create singleton instance
export const messageManager = new MessageManager();

export default messageManager;