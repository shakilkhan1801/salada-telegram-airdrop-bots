import { Context, Scenes } from 'telegraf';
import { InlineKeyboardMarkup, InlineKeyboardButton } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../../services/logger';
import { StorageManager } from '../../storage';
import { getConfig } from '../../config';
import { SecurityUtils } from '../../security';
import { WalletConnectService } from '../../services/walletconnect.service';
import { QRCodeService } from '../../services/qrcode.service';
import { WalletAppsService } from '../../services/wallet-apps.service';
import { TelegramNotifyService } from '../../services/telegram-notify.service';
import { ethers } from 'ethers';
import { ClaimService } from '../../services/claim.service';
import { 
  UserValidationService, 
  CallbackQueryService, 
  MessageService,
  DateUtils,
  PointsService,
  PointTransactionType,
  PointEarningCategory,
  RateLimitService,
  RateLimitAction,
  ActionSession
} from '../../shared';


import { 
  WalletType, 
  WalletConnection, 
  WalletAppId,
  WalletConnectRequest,
  QRCodeSession,
  TelegramInlineButton,
  isEthereumAddress,
  isBitcoinAddress,
  isSolanaAddress,
  isTonAddress,
} from '../../types/wallet.types';
import {
  TransferRecord,
  TransferRequest,
  TransferValidationResult,
  UserLookupResult
} from '../../types/transfer.types';
import {
  generateTransferHash,
  generateTransferId,
  formatTransferHash,
  calculateTransferFee,
  validateTransferAmount,
  parseRecipientInput,
  formatPoints,
  getTimeUntilNextTransfer,
  createTransferNotificationMessage,
  isValidUsername
} from '../../utils/transfer-utils';

export class WalletHandler {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly config = getConfig();
  private readonly walletConnectService = WalletConnectService.getInstance();
  private readonly qrCodeService = QRCodeService.getInstance();
  private readonly walletAppsService = WalletAppsService.getInstance();

  /**
   * Initialize the wallet handler
   */
  async initialize(): Promise<void> {
    try {
      await this.walletConnectService.initialize();
      this.logger.info('WalletHandler initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize WalletHandler:', error);
      throw error;
    }
  }

  /**
   * Normalize channel ID to ensure proper format
   * Examples:
   *   "salada_protocol" -> "@salada_protocol"
   *   "@salada_protocol" -> "@salada_protocol"
   *   "-1001234567890" -> "-1001234567890"
   */
  private normalizeChannelId(channelId: string): string {
    if (!channelId) return channelId;
    
    // If it's a numeric ID (starts with - or is all digits), return as-is
    if (channelId.startsWith('-') || /^\d+$/.test(channelId)) {
      return channelId;
    }
    
    // If it already has @, return as-is
    if (channelId.startsWith('@')) {
      return channelId;
    }
    
    // Otherwise, add @ prefix
    return `@${channelId}`;
  }

  /**
   * Show wallet information and options
   */
  async showWallet(ctx: Context): Promise<void> {
    try {
      try { (await import('../../shared')).UserValidationService.invalidateSessionUser(ctx); } catch {}
      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      const userId = ctx.from?.id?.toString();
      let sessionStatus: 'active' | 'expired' | 'none' = 'none';
      let connectionMethod = 'manual';

      if (userId && user.walletAddress) {
        const connections = await this.storage.getWalletConnections(userId);
        const latest = connections[0];
        if (latest) {
          connectionMethod = this.getConnectionMethodName(latest.metadata?.connectionMethod || 'manual_entry');
          if (latest.walletConnectSession) {
            const now = Date.now();
            const expiresAt = latest.expiresAt ? new Date(latest.expiresAt).getTime() : now - 1;
            const wcActive = this.walletConnectService.isSessionActive(latest.walletConnectSession.topic);
            sessionStatus = latest.isActive && wcActive && expiresAt > now ? 'active' : 'expired';
          }
        }
      }

      let walletText: string;

      if (user.walletAddress) {
        const statusLine = sessionStatus === 'active'
          ? '🟢 Status: Active session'
          : sessionStatus === 'expired'
            ? '🟡 Status: Session expired – please reconnect'
            : '🟦 Status: Saved wallet (no active session)';
        walletText = `
👛 <b>Your Wallet</b>

✅ <b>Connected Wallet:</b>
📍 Address: <code>${this.maskWalletAddress(user.walletAddress)}</code>
🔗 Type: ${this.detectWalletType(user.walletAddress)}
🌐 Connection: ${connectionMethod}
${statusLine}

💰 <b>Points Available:</b>
Current Balance: <b>${user.points?.toLocaleString() || '0'}</b>
Minimum Withdrawal: <b>${this.config.points.minWithdraw}</b>

📊 <b>Withdrawal Status:</b>
${(user.points || 0) >= this.config.points.minWithdraw
  ? '✅ You can withdraw your points!'
  : `❌ Need ${this.config.points.minWithdraw - (user.points || 0)} more points to withdraw`}

🎯 <b>Next Steps:</b>
• Complete more tasks to earn points
• Refer friends for bonus points
• Watch for withdrawal announcements
        `.trim();
      } else {
        walletText = `
👛 <b>Wallet Connection</b>

❌ <b>No Wallet Connected</b>

🔗 Connect your wallet to:
• Withdraw earned tokens
• Receive future airdrop distributions
• Access token claiming features
• Secure your rewards

💡 <b>Connection Methods:</b>
• <b>Wallet Apps:</b> Direct connection via popular wallets
• <b>QR Code:</b> Universal connection method

🔒 <b>Security:</b>
Powered by WalletConnect v2 protocol. Your private keys never leave your wallet. We only store your wallet address for reward distribution.
        `.trim();
      }

      const baseKeyboard = this.getWalletKeyboard(user) as any;
      const keyboard = sessionStatus === 'expired'
        ? { inline_keyboard: [[{ text: 'Reconnect Wallet', callback_data: 'wallet_connect' }], ...baseKeyboard.inline_keyboard] }
        : baseKeyboard;

      await MessageService.editOrReply(ctx, walletText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing wallet:', error);
      await ctx.reply('❌ Error loading wallet information.');
    }
  }

  /**
   * Start wallet connection process
   */
  async startWalletConnection(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Check rate limit
      if (!(await RateLimitService.checkAndEnforce(ctx, RateLimitAction.WALLET_CONNECTION))) {
        return;
      }

      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      if (user.walletAddress) {
        await ctx.reply(
          '👛 You already have a connected wallet.\n\n' +
          `Current: <code>${this.maskWalletAddress(user.walletAddress)}</code>\n\n` +
          'Only your first wallet is allowed for security.\nYou can reconnect your session if it expired.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Reconnect Wallet', callback_data: 'wallet_connect' }],
                [{ text: 'Back', callback_data: 'wallet_show' }]
              ]
            }
          }
        );
        return;
      }

      // Show wallet connection options
      await this.showWalletConnectionOptions(ctx);

    } catch (error) {
      this.logger.error('Error starting wallet connection:', error);
      await ctx.reply('❌ Error starting wallet connection.');
    }
  }

  /**
   * Show wallet connection options with WalletConnect v2
   */
  async showWalletConnectionOptions(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Get enabled wallet apps
      const enabledWallets = this.walletAppsService.getEnabledWalletApps();
      
      if (enabledWallets.length === 0) {
        await ctx.reply(
          '❌ No wallet apps are currently enabled.\n\n' +
          'Please contact support for assistance.',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Back', callback_data: 'wallet_show' }]
              ]
            }
          }
        );
        return;
      }

      // Check if user is trying to reconnect (has previousWallet but no current walletAddress)
      const currentUser = await this.storage.getUser(userId);
      if (currentUser && currentUser.previousWallet && !currentUser.walletAddress) {
        // User is reconnecting after disconnect - remind them about wallet lock
        const connectionText = 
          '🔗 <b>Reconnect Your Wallet</b>\n\n' +
          `🎯 <b>Your Registered Wallet:</b>\n<code>${this.maskWalletAddress(currentUser.previousWallet)}</code>\n\n` +
          '🔒 <b>Security Note:</b>\n' +
          'You can only reconnect your original wallet address. This policy ensures fair distribution and prevents abuse.\n\n' +
          '💡 If you lost access to your original wallet, please contact support.';
        
        // Still proceed with connection request but user is warned
      }
      
      // Generate WalletConnect v2 connection request
      const wcRequest = await this.walletConnectService.createConnectionRequest(
        userId
      );

      if (!wcRequest) {
        // Check if user already has wallet connected (wallet lock)
        const currentUser = await this.storage.getUser(userId);
        if (currentUser && currentUser.walletAddress) {
          await ctx.reply(
            '🔒 <b>Wallet Already Connected</b>\n\n' +
            '✅ You already have a wallet connected to your account.\n' +
            `💳 Current Wallet: <code>${currentUser.walletAddress}</code>\n\n` +
            '⚠️ <b>Security Note:</b> Only one wallet per user is allowed to prevent abuse.\n\n' +
            '💡 If you need to change wallets, please contact support.',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
                ]
              },
              parse_mode: 'HTML'
            }
          );
          return;
        }
        throw new Error('Failed to create WalletConnect request');
      }

      const connectionTimeoutMinutes = Math.floor(this.config.wallet.walletConnect.approvalTimeoutMs / 60000);
      const connectionExpiryMinutes = Math.floor(this.config.wallet.walletConnect.connectionExpiryMs / 60000);
      
      const connectionText = 
        '👛 <b>Connect Your Wallet</b>\n\n' +
        '🔗 Choose your preferred wallet app:\n\n' +
        '📱 <b>Mobile:</b> Tap wallet button to open app\n' +
        '💻 <b>Desktop:</b> Use QR code to scan with mobile wallet\n\n' +
        '⚡ <b>Benefits:</b>\n' +
        '• Receive airdrop rewards\n' +
        '• Access exclusive wallet-only tasks\n' +
        '• Increase your security score\n\n' +
        `⏰ <b>Important:</b> You have ${connectionTimeoutMinutes} minutes to approve the connection in your wallet.\n` +
        `🔗 Connection expires in ${connectionExpiryMinutes} minutes.\n\n` +
        '🔒 Secured by WalletConnect v2 protocol.';

      // Create dynamic keyboard with wallet app URL buttons
      const keyboard: any[][] = [];
      
      // Add wallet app URL buttons (2 per row)
      const walletButtons: TelegramInlineButton[] = [];
      for (let i = 0; i < Math.min(enabledWallets.length, 8); i++) {
        const wallet = enabledWallets[i];
        const deepLink = this.walletAppsService.generateDeepLink(wallet.id, wcRequest.uri);
        
        walletButtons.push({
          text: `${wallet.icon} ${wallet.name}`,
          url: deepLink
        });
      }

      // Group wallet buttons in rows of 2
      for (let i = 0; i < walletButtons.length; i += 2) {
        keyboard.push(walletButtons.slice(i, i + 2));
      }

      // Add QR code option (callback since it generates image)
      keyboard.push([
        { text: 'Show QR Code', callback_data: `wallet_qr_${wcRequest.id}` }
      ]);


      // Add back button
      keyboard.push([{ text: 'Back', callback_data: 'wallet_show' }]);

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(connectionText, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'HTML'
          });
        } catch (editError: any) {
          // If editing fails (e.g., message has no text), send a new message
          if (editError.message && editError.message.includes('no text in the message to edit')) {
            await ctx.reply(connectionText, {
              reply_markup: { inline_keyboard: keyboard },
              parse_mode: 'HTML'
            });
          } else {
            throw editError;
          }
        }
      } else {
        await ctx.reply(connectionText, {
          reply_markup: { inline_keyboard: keyboard },
          parse_mode: 'HTML'
        });
      }

    } catch (error) {
      this.logger.error('Error showing wallet connection options:', error);
      await ctx.reply('❌ Error loading wallet options.');
    }
  }

  /**
   * Handle wallet app selection
   */
  async handleWalletAppConnection(ctx: Context, walletAppId: WalletAppId): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      await CallbackQueryService.safeAnswerCallback(ctx, '🔄 Creating connection...');

      // Get wallet app info
      const walletApp = this.walletAppsService.getWalletApp(walletAppId);
      if (!walletApp) {
        await ctx.reply('❌ Wallet app not found.');
        return;
      }

      // Create WalletConnect connection request
      const wcRequest = await this.walletConnectService.createConnectionRequest(userId, walletAppId);
      
      // Generate deep link for the specific wallet
      const deepLink = this.walletAppsService.generateDeepLink(walletAppId, wcRequest.uri);

      const connectionTimeoutMinutes = Math.floor(this.config.wallet.walletConnect.approvalTimeoutMs / 60000);
      const connectionExpiryMinutes = Math.floor(this.config.wallet.walletConnect.connectionExpiryMs / 60000);
      
      const connectionText = 
        `🔗 <b>Connect ${walletApp.name}</b>\n\n` +
        `${walletApp.icon} <b>${walletApp.name}</b>\n` +
        `${walletApp.description}\n\n` +
        '📱 <b>Instructions:</b>\n' +
        '1. Click "Open in Wallet" button below\n' +
        '2. Approve the connection in your wallet\n' +
        '3. Return to this chat for confirmation\n\n' +
        `⏰ <b>Time Limits:</b>\n` +
        `• Approve within ${connectionTimeoutMinutes} minutes\n` +
        `• Connection expires in ${connectionExpiryMinutes} minutes\n\n` +
        '🔒 Your private keys never leave your wallet';

      const keyboard: any[][] = [
        [{ text: `Open in ${walletApp.name}`, url: deepLink }],
        [{ text: 'Show QR Code', callback_data: `wallet_qr_${wcRequest.id}` }],
        [{ text: 'Refresh', callback_data: `wallet_app_${walletAppId}` }],
        [{ text: 'Back', callback_data: 'wallet_connect' }]
      ];

      await ctx.editMessageText(connectionText, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });

      this.logger.info('Wallet app connection initiated', {
        userId,
        walletAppId,
        requestId: wcRequest.id
      });

    } catch (error) {
      this.logger.error('Error handling wallet app connection:', error);
      await ctx.reply('❌ Error creating wallet connection. Please try again.');
    }
  }

  /**
   * Show QR code for wallet connection
   */
  async showWalletQRCode(ctx: Context, requestId?: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      await CallbackQueryService.safeAnswerCallback(ctx, '📱 Generating QR code...');

      let wcRequest: WalletConnectRequest;

      if (requestId) {
        // Use existing request
        const existingRequest = await this.storage.getWalletConnectRequest(requestId);
        if (!existingRequest) {
          await ctx.reply('❌ Connection request not found or expired.');
          return;
        }
        wcRequest = existingRequest;
      } else {
        // Create new request for QR code
        try {
          wcRequest = await this.walletConnectService.createConnectionRequest(userId);
        } catch (createError) {
          this.logger.error('Failed to create WalletConnect request:', createError);
          await ctx.reply(
            '❌ Failed to create connection request. Please try again or use wallet apps.',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Try Again', callback_data: 'wallet_qr_code' }],
                  [{ text: 'Try Wallet Apps', callback_data: 'wallet_connect' }],
                  [{ text: 'Back', callback_data: 'wallet_show' }]
                ]
              }
            }
          );
          return;
        }
      }

      // Check if request is still valid
      const reqExpiry = (wcRequest as any).expiresAt ? new Date((wcRequest as any).expiresAt).getTime() : wcRequest.expiryTimestamp;
      if (reqExpiry < Date.now()) {
        await ctx.reply('❌ Connection request expired. Please try again.');
        return;
      }

      // Generate QR code
      let qrSession;
      let qrBuffer;
      
      try {
        this.logger.info('Generating QR code session...', { userId, requestId: wcRequest.id });
        qrSession = await this.qrCodeService.generateQRCode(
          userId, 
          wcRequest.uri,
          wcRequest.walletAppId
        );
        
        this.logger.info('Generating QR code buffer...');
        // Generate QR code as buffer for sending as photo
        qrBuffer = await this.qrCodeService.generateQRCodeBuffer(wcRequest.uri);
        
        this.logger.info('QR code buffer generated', { bufferSize: qrBuffer?.length });
      } catch (qrError) {
        this.logger.error('QR code generation failed:', qrError);
        // If QR generation fails, show connection string instead
        await ctx.editMessageText(
          '📱 <b>Wallet Connection</b>\n\n' +
          '⚠️ QR code generation failed. Use the connection string instead:\n\n' +
          '🔗 <b>Connection String:</b>\n' +
          `<code>${wcRequest.uri}</code>\n\n` +
          '📷 <b>Instructions:</b>\n' +
          '1. Copy the connection string above\n' +
          '2. Open your wallet app\n' +
          '3. Find "WalletConnect" section\n' +
          '4. Paste the connection string\n\n' +
          '🔒 Secured by WalletConnect v2 protocol',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Try Again', callback_data: 'wallet_qr_code' }],
                [{ text: 'Try Wallet Apps', callback_data: 'wallet_connect' }],
                [{ text: 'Back', callback_data: 'wallet_connect' }]
              ]
            }
          }
        );
        return;
      }

      const connectionTimeoutMinutes = Math.floor(this.config.wallet.walletConnect.approvalTimeoutMs / 60000);
      const qrExpirySeconds = this.config.wallet.qrCode.expirySeconds;
      
      const qrText = 
        '📱 <b>QR Code Wallet Connection</b>\n\n' +
        '📷 <b>Instructions:</b>\n' +
        '1. Open your wallet app\n' +
        '2. Find "WalletConnect" or "Scan QR Code"\n' +
        '3. Point your camera at the QR code above\n' +
        '4. Approve the connection request\n\n' +
        `⏰ <b>Time Limits:</b>\n` +
        `• QR Code expires in ${qrExpirySeconds} seconds\n` +
        `• Approve within ${connectionTimeoutMinutes} minutes\n\n` +
        '🔒 Secured by WalletConnect v2 protocol\n\n' +
        '💡 <b>Supported Wallets:</b>\n' +
        'MetaMask, Trust Wallet, Coinbase Wallet,\n' +
        'Rainbow, and many more...';

      const keyboard: any[][] = [
        [{ text: 'Generate New QR', callback_data: 'wallet_qr_code' }],
        [{ text: 'Try Wallet Apps', callback_data: 'wallet_connect' }],
        [{ text: 'Back', callback_data: 'wallet_connect' }]
      ];

      // Alternative approach - show QR instructions with deep link
      const qrInstructionsText = 
        '📱 <b>QR Code Wallet Connection</b>\n\n' +
        '📷 <b>Instructions:</b>\n' +
        '1. Open your wallet app\n' +
        '2. Find "WalletConnect" or "Scan QR Code"\n' +
        '3. Scan QR code or use the connection string below\n\n' +
        '🔗 <b>Connection String:</b>\n' +
        `<code>${wcRequest.uri}</code>\n\n` +
        `⏰ <b>Time Limits:</b>\n` +
        `• QR Code expires in ${qrExpirySeconds} seconds\n` +
        `• Approve within ${connectionTimeoutMinutes} minutes\n\n` +
        '💡 <b>Alternative Methods:</b>\n' +
        '• Copy the connection string above\n' +
        '• Paste it in your wallet\'s WalletConnect section\n\n' +
        '🔒 Secured by WalletConnect v2 protocol';
      
      const enhancedKeyboard: any[][] = [
        [{ text: 'Copy Connection String', callback_data: 'wallet_copy_uri' }],
        ...keyboard
      ];
      
      // Try to send photo, but if fails, send text
      try {
        await ctx.deleteMessage();
        await ctx.replyWithPhoto(
          { source: qrBuffer },
          {
            caption: qrText,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'HTML'
          }
        );
      } catch (photoError) {
        this.logger.warn('Failed to send QR photo, sending text alternative:', photoError);
        // If photo fails, edit message with text instructions
        await ctx.editMessageText(qrInstructionsText, {
          reply_markup: { inline_keyboard: enhancedKeyboard },
          parse_mode: 'HTML'
        });
      }

      this.logger.info('QR code generated for wallet connection', {
        userId,
        qrSessionId: qrSession.id,
        requestId: wcRequest.id
      });

    } catch (error) {
      this.logger.error('Error showing wallet QR code:', error);
      await ctx.reply('❌ Error generating QR code. Please try again.');
    }
  }

  /**
   * Show more wallet apps
   */
  async showMoreWalletApps(ctx: Context): Promise<void> {
    try {
      const enabledWallets = this.walletAppsService.getEnabledWalletApps();
      
      const moreWalletsText = 
        '📱 <b>All Available Wallets</b>\n\n' +
        'Choose your preferred wallet app:\n\n' +
        enabledWallets.map(wallet => 
          `${wallet.icon} <b>${wallet.name}</b>\n${wallet.description}\n`
        ).join('\n');

      const keyboard: any[][] = [];
      
      // Create buttons for all wallets
      for (const wallet of enabledWallets) {
        keyboard.push([{
          text: `${wallet.icon} ${wallet.name}`,
          callback_data: `wallet_app_${wallet.id}`
        }]);
      }

      keyboard.push([{ text: 'Back', callback_data: 'wallet_connect' }]);

      await ctx.editMessageText(moreWalletsText, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing more wallet apps:', error);
      await ctx.reply('❌ Error loading wallet apps.');
    }
  }

  /**
   * Handle manual wallet connection
   */
  async processManualWalletConnection(ctx: Context, walletAddress: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Validate wallet address
      const isValid = this.isValidWalletAddress(walletAddress);
      if (!isValid) {
        await ctx.reply(
          '❌ <b>Invalid Wallet Address</b>\n\n' +
          'Please check your address and try again.\n\n' +
          '✅ <b>Supported formats:</b>\n' +
          '• Ethereum: 0x...\n' +
          '• Bitcoin: 1..., 3..., or bc1...\n' +
          '• Solana: Base58 format\n' +
          '• TON: EQ... or 0:...',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Normalize Ethereum address for lookup
      if (isEthereumAddress(walletAddress)) {
        walletAddress = walletAddress.toLowerCase();
      }
      // Check if wallet is already used
      const existingUser = await this.storage.getUserByWallet(walletAddress);
      if (existingUser && existingUser.telegramId !== userId) {
        await ctx.reply(
          '😼 <b>We caught you — nice try!</b>\n\n' +
          `This wallet <code>${this.maskWalletAddress(walletAddress)}</code> is already connected to another account.\n` +
          'For fairness and security, each wallet can be linked to only one account.\n' +
          'If you attempt to bypass this rule, we may block both accounts.',
          {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'View Wallet', callback_data: 'wallet_show' },
                  { text: 'Main Menu', callback_data: 'menu_main' }
                ],
                [ { text: 'Get Help', callback_data: 'menu_help' } ]
              ]
            }
          } as any
        );
        return;
      }

      // Enforce single-wallet policy
      // Normalize Ethereum address to lowercase for consistent storage
      if (isEthereumAddress(walletAddress)) {
        walletAddress = walletAddress.toLowerCase();
      }

      const currentUser = await this.storage.getUser(userId);
      if (currentUser) {
        if (currentUser.previousWallet && currentUser.previousWallet !== walletAddress) {
          await ctx.reply(
            '🔒 <b>Wallet Locked</b>\n\n' +
            'Only your first connected wallet is allowed for security.\n' +
            `Original: <code>${this.maskWalletAddress(currentUser.previousWallet)}</code>`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Reconnect Wallet', callback_data: 'wallet_connect' }],
                  [{ text: 'Back', callback_data: 'wallet_show' }]
                ]
              }
            } as any
          );
          return;
        }

        const updates: any = { walletAddress: walletAddress };
        if (!currentUser.previousWallet && !currentUser.walletAddress) {
          updates.previousWallet = walletAddress;
        }
        await this.storage.updateUser(userId, updates);
      } else {
        await this.storage.updateUser(userId, { walletAddress: walletAddress });
      }

      // Log wallet connection
      const connection: WalletConnection = {
        id: `conn_${Date.now()}_${userId}`,
        userId,
        walletAddress,
        walletType: this.detectWalletType(walletAddress),
        chainId: this.config.wallet.chainId,
        connectedAt: new Date(),
        lastActiveAt: new Date().toISOString(),
        isActive: true,
        metadata: {
          connectionMethod: 'manual_entry',
          verificationStatus: 'verified'
        }
      };

      await this.storage.saveWalletConnection(connection);

      // Connection bonus removed per user request

      // Invalidate session cache so subsequent views reflect new walletAddress
      try { (await import('../../shared')).UserValidationService.invalidateSessionUser(ctx); } catch {}

      await ctx.reply(
        '✅ <b>Wallet Connected Successfully!</b>\n\n' +
        `👛 Address: <code>${this.maskWalletAddress(walletAddress)}</code>\n` +
        `🔗 Type: ${this.getWalletTypeName(connection.walletType)}\n` +
        `🎉 You can now access wallet-exclusive features!\n\n` +
        'Your wallet is now connected securely!',
        { parse_mode: 'HTML' }
      );

      // Show wallet summary immediately
      await this.showWallet(ctx);

    } catch (error) {
      this.logger.error('Error processing manual wallet connection:', error);
      await ctx.reply('❌ Error connecting wallet. Please try again.');
    }
  }

  /**
   * Handle withdrawal options
   */
  async showWithdrawal(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      if (!user.walletAddress) {
        await ctx.reply(
          '❌ You need to connect a wallet before withdrawing.\n\n' +
          'Use the wallet menu to connect your wallet first.',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Connect Wallet', callback_data: 'wallet_connect' }],
                [{ text: 'Back', callback_data: 'wallet_show' }]
              ]
            }
          }
        );
        return;
      }

      // Check if channel join is required for withdrawal
      if (this.config.points.requireChannelJoinForWithdrawal && this.config.bot.requiredChannelId) {
        try {
          const channelId = this.normalizeChannelId(this.config.bot.requiredChannelId);
          const member = await ctx.telegram.getChatMember(channelId, parseInt(userId));
          const isJoined = ['member', 'administrator', 'creator'].includes(member.status);
          
          if (!isJoined) {
            await ctx.reply(
              '❌ <b>Channel Join Required</b>\n\n' +
              'You must join our Telegram channel before withdrawing tokens.\n\n' +
              `Please join: ${channelId}\n\n` +
              'After joining, try again.',
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'Join Channel', url: `https://t.me/${channelId.replace('@', '')}` }],
                    [{ text: 'I Joined - Check Again', callback_data: 'wallet_withdraw' }],
                    [{ text: 'Back', callback_data: 'wallet_show' }]
                  ]
                }
              }
            );
            return;
          }
        } catch (error) {
          this.logger.error('Error checking channel membership:', error);
          // Continue with withdrawal if channel check fails (don't block users due to API errors)
        }
      }

      const withdrawalText = this.getWithdrawalText(user);
      const keyboard = this.getWithdrawalKeyboard(user);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(withdrawalText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(withdrawalText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }

    } catch (error) {
      this.logger.error('Error showing withdrawal:', error);
      await ctx.reply('❌ Error loading withdrawal information.');
    }
  }

  /**
   * Handle callback queries for wallet operations with enhanced timeout management
   */
  async handleCallback(ctx: Context): Promise<void> {
    const rawData = (ctx.callbackQuery as any)?.data as string | undefined;
    
    if (!rawData) {
      this.logger.warn('Wallet callback received without data');
      return;
    }
    
    // Debug logging
    this.logger.debug('Wallet callback received', {
      rawData
    });
    
    // Try to parse as session-based callback first
    const callbackData = CallbackQueryService.parseCallbackDataWithSession(ctx);
    
    if (callbackData.action && callbackData.sessionId) {
      // Handle session-based callbacks
      await CallbackQueryService.handleCallbackWithSession(
        ctx,
        callbackData.sessionId,
        async (ctx, session) => {
          await this.handleSessionAction(ctx, session, callbackData);
        }
      );
      return;
    }
    
    // Handle direct callback data (legacy format)
    await this.handleLegacyCallback(ctx, rawData);

  }

  /**
   * Handle legacy callback data format for backward compatibility
   */
  private async handleLegacyCallback(ctx: Context, data: string): Promise<void> {
    if (data === 'wallet_show') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showWallet(ctx);
      }, true);
    } else if (data === 'wallet_connect' || data === 'wallet_connect_new') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showWalletConnectionOptions(ctx);
      }, true);
    } else if (data === 'wallet_qr_code') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showWalletQRCode(ctx);
      }, true);
    } else if (data.startsWith('wallet_qr_')) {
      const requestId = data.replace('wallet_qr_', '');
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showWalletQRCode(ctx, requestId);
      }, true);
    } else if (data === 'wallet_apps_more') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showMoreWalletApps(ctx);
      }, true);
    } else if (data.startsWith('wallet_app_')) {
      const walletAppId = data.replace('wallet_app_', '') as WalletAppId;
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.handleWalletAppConnection(ctx, walletAppId);
      }, true);
    } else if (data === 'wallet_withdraw') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showWithdrawal(ctx);
      }, true);
    } else if (data === 'wallet_history') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showWalletHistory(ctx);
      }, true);
    } else if (data === 'wallet_disconnect') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.handleWalletDisconnection(ctx);
      }, true);
    } else if (data === 'wallet_disconnect_confirm') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.confirmWalletDisconnection(ctx);
      }, true);
    } else if (data === 'wallet_withdraw_auto') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.processAutomaticWithdrawal(ctx);
      }, true);
    } else if (data.startsWith('wallet_confirm_withdraw_')) {
      const userId = data.replace('wallet_confirm_withdraw_', '');
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.executeWithdrawal(ctx, userId);
      }, true);
    } else if (data === 'wallet_transfer') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showTransferMenu(ctx);
      }, true);
    } else if (data === 'transfer_start') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.startTransferProcess(ctx);
      }, true);
    } else if (data.startsWith('transfer_confirm_')) {
      const transferId = data.replace('transfer_confirm_', '');
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.confirmTransfer(ctx, transferId);
      }, true);
    } else if (data.startsWith('transfer_cancel_')) {
      const transferId = data.replace('transfer_cancel_', '');
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.cancelTransfer(ctx, transferId);
      }, true);
    } else if (data === 'transfer_history') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showTransferHistory(ctx);
      }, true);
    } else if (data === 'wallet_copy_uri') {
      // Just answer the callback, user will copy from the message
      await CallbackQueryService.safeAnswerCallback(ctx, '📋 Copy the connection string from the message above');
    } else {
      // Log unhandled callback
      this.logger.warn('Unhandled wallet callback', { data });
      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Unknown action');
    }
  }

  /**
   * Handle navigation actions (no session required)
   */
  private async handleNavigationAction(ctx: Context, action: string, params?: string[]): Promise<void> {
    switch (action) {
      case 'wallet_show':
        await this.showWallet(ctx);
        break;
      case 'wallet_connect':
      case 'wallet_connect_new':
        await this.showWalletConnectionOptions(ctx);
        break;
      case 'wallet_apps_more':
        await this.showMoreWalletApps(ctx);
        break;
      case 'wallet_withdraw':
        await this.showWithdrawal(ctx);
        break;
      case 'wallet_history':
        await this.showWalletHistory(ctx);
        break;
      case 'wallet_transfer':
        await this.showTransferMenu(ctx);
        break;
      case 'transfer_history':
        await this.showTransferHistory(ctx);
        break;
      case 'transfer_start':
        await this.startTransferProcess(ctx);
        break;
      case 'wallet_qr':
        if (params && params[0]) {
          await this.showWalletQRCode(ctx, params[0]);
        } else {
          await this.showWalletQRCode(ctx);
        }
        break;
      case 'wallet_app':
        if (params && params[0]) {
          await this.handleWalletAppConnection(ctx, params[0] as WalletAppId);
        } else {
          await ctx.reply('❌ Unknown wallet app');
        }
        break;
      case 'wallet_disconnect':
        await this.handleWalletDisconnection(ctx);
        break;
      default:
        await ctx.reply('❌ Unknown action');
    }
  }

  /**
   * Handle session-based actions that require timeout validation
   */
  private async handleSessionAction(ctx: Context, session: ActionSession, callbackData: any): Promise<void> {
    const { action, params } = callbackData;
    const userId = ctx.from?.id?.toString();

    switch (action) {
      case 'wallet_disconnect_confirm':
        if (session.action === 'wallet_disconnect') {
          this.logger.debug('Processing wallet disconnection with session validation', {
            sessionId: session.id,
            userId: session.userId
          });
          await this.confirmWalletDisconnection(ctx);
        } else {
          await CallbackQueryService.safeAnswerCallback(ctx, '❌ Invalid session action');
        }
        break;
        
      case 'wallet_confirm_withdraw':
        if (session.action === 'wallet_withdraw') {
          this.logger.debug('Processing withdrawal execution with session validation', {
            sessionId: session.id,
            userId: session.userId
          });
          // Use session.userId instead of ctx userId to ensure consistency
          await this.executeWithdrawal(ctx, session.userId);
        } else {
          await CallbackQueryService.safeAnswerCallback(ctx, '❌ Invalid withdrawal session');
        }
        break;
        
      case 'wallet_withdraw_auto_session':
        if (session.action === 'wallet_withdraw_auto') {
          this.logger.debug('Processing automatic withdrawal with session validation', {
            sessionId: session.id,
            userId: session.userId,
            points: session.metadata?.points
          });
          await this.processAutomaticWithdrawal(ctx);
        } else {
          await CallbackQueryService.safeAnswerCallback(ctx, '❌ Invalid withdrawal session');
        }
        break;
        
      case 'transfer_confirm':
        if (session.action === 'transfer_process' && params && params[0]) {
          this.logger.debug('Processing transfer confirmation with session validation', {
            sessionId: session.id,
            userId: session.userId,
            transferId: params[0]
          });
          await this.confirmTransfer(ctx, params[0]);
        } else {
          await CallbackQueryService.safeAnswerCallback(ctx, '❌ Invalid transfer session');
        }
        break;
        
      case 'transfer_cancel':
        if (session.action === 'transfer_cancel' && params && params[0]) {
          this.logger.debug('Processing transfer cancellation with session validation', {
            sessionId: session.id,
            userId: session.userId,
            transferId: params[0]
          });
          await this.cancelTransfer(ctx, params[0]);
        } else {
          await CallbackQueryService.safeAnswerCallback(ctx, '❌ Invalid transfer session');
        }
        break;
        
      default:
        this.logger.warn('Unknown session action:', action);
        await CallbackQueryService.safeAnswerCallback(ctx, '❌ Unknown action');
    }
  }

  /**
   * Get wallet connection scene (removed manual connection)
   */
  getWalletConnectionScene(): Scenes.BaseScene<any>[] {
    // Return empty array since we removed manual connection
    // Keep this method for compatibility with bot setup
    return [];
  }

  /**
   * Process automatic withdrawal request
   */
  async processAutomaticWithdrawal(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      // Check if wallet is connected
      if (!user.walletAddress) {
        await ctx.reply(
          '❌ Please connect your wallet first to withdraw tokens.',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Connect Wallet', callback_data: 'wallet_connect' }],
                [{ text: 'Back', callback_data: 'wallet_show' }]
              ]
            }
          }
        );
        return;
      }

      // Check if channel join is required for withdrawal
      if (this.config.points.requireChannelJoinForWithdrawal && this.config.bot.requiredChannelId) {
        try {
          const channelId = this.normalizeChannelId(this.config.bot.requiredChannelId);
          const member = await ctx.telegram.getChatMember(channelId, parseInt(userId));
          const isJoined = ['member', 'administrator', 'creator'].includes(member.status);
          
          if (!isJoined) {
            await ctx.reply(
              '❌ <b>Channel Join Required</b>\n\n' +
              'You must join our Telegram channel before withdrawing tokens.\n\n' +
              `Please join: ${channelId}\n\n` +
              'After joining, try the withdrawal again.',
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'Join Channel', url: `https://t.me/${channelId.replace('@', '')}` }],
                    [{ text: 'I Joined - Try Again', callback_data: 'wallet_withdraw_auto' }],
                    [{ text: 'Back', callback_data: 'wallet_show' }]
                  ]
                }
              }
            );
            return;
          }
        } catch (error) {
          this.logger.error('Error checking channel membership for withdrawal:', error);
          // Continue with withdrawal if channel check fails (don't block users due to API errors)
        }
      }

      // Check minimum withdrawal requirement
      const userPoints = user.points || 0;
      const minWithdraw = this.config.points.minWithdraw;
      
      if (userPoints < minWithdraw) {
        await ctx.reply(
          `❌ <b>Insufficient Balance</b>\n\n` +
          `You need ${(minWithdraw - userPoints).toLocaleString()} more points to withdraw.\n\n` +
          `Current Balance: ${userPoints.toLocaleString()} points\n` +
          `Minimum Required: ${minWithdraw.toLocaleString()} points`,
          { 
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Earn More Points', callback_data: 'menu_tasks' }],
                [{ text: 'Back', callback_data: 'wallet_show' }]
              ]
            }
          }
        );
        return;
      }

      const withdrawMode = (this.config.wallet as any).withdrawMode || 'claim';
      if (withdrawMode === 'claim') {
        const connections = await this.storage.getWalletConnections(userId);
        const activeConnection = connections.find(conn => conn.isActive && conn.walletConnectSession);
        if (!activeConnection || !activeConnection.walletConnectSession) {
          await ctx.reply(
            '❌ <b>Wallet Session Expired</b>\n\n' +
            'Your WalletConnect session has expired. Please reconnect your wallet to continue.',
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Reconnect Wallet', callback_data: 'wallet_connect' }],
                  [{ text: 'Back', callback_data: 'wallet_show' }]
                ]
              }
            }
          );
          return;
        }
        const activeSessions = this.walletConnectService.getActiveSessions();
        const sessionTopic = activeConnection.walletConnectSession.topic;
        if (!activeSessions[sessionTopic]) {
          await this.storage.deactivateWalletConnectionByTopic(sessionTopic);
          // Don't remove walletAddress, just log the session expiry
          await ctx.reply(
            '❌ <b>Wallet Session Invalid</b>\n\n' +
            '🔄 Your wallet connection has been disconnected or expired.\n' +
            '⚡ Please reconnect your wallet to continue with the withdrawal.\n\n' +
            '💡 <b>Tip:</b> Make sure your wallet app is still connected.',
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Reconnect Wallet', callback_data: 'wallet_connect' }],
                  [{ text: 'Back', callback_data: 'wallet_show' }]
                ]
              }
            }
          );
          return;
        }
      }

      // Calculate token amount using conversion rate
      const conversionRate = this.config.points.conversionRate;
      const tokenAmount = userPoints * conversionRate;
      const formattedTokenAmount = tokenAmount.toFixed(6);

      const steps = ((this.config.wallet as any).withdrawMode || 'claim') === 'claim'
        ? `2. Approve the signature request in your wallet\n3. Tokens will be transferred by your wallet`
        : `2. Tokens will be sent from our distribution wallet\n3. You'll receive confirmation after on-chain success`;
      const security = ((this.config.wallet as any).withdrawMode || 'claim') === 'claim'
        ? '🔒 <b>Security:</b> Transaction secured by WalletConnect signature'
        : '🔒 <b>Security:</b> On-chain transfer from verified distributor';
      const confirmationText = 
        `🚀 <b>Withdraw Confirmation</b>\n\n` +
        `💰 <b>Points to Withdraw:</b> ${userPoints.toLocaleString()} points\n` +
        `🪙 <b>Tokens to Receive:</b> ${formattedTokenAmount} ${this.config.wallet.tokenSymbol}\n` +
        `📊 <b>Exchange Rate:</b> 1 point = ${conversionRate} ${this.config.wallet.tokenSymbol}\n\n` +
        `👛 <b>Destination Wallet:</b>\n<code>${this.maskWalletAddress(user.walletAddress)}</code>\n\n` +
        `⚡ <b>Next Steps:</b>\n` +
        `1. Click "Confirm Withdrawal" below\n` +
        `${steps}\n\n` +
        `${security}`;

      // Create session for withdrawal confirmation (10 minutes timeout)
      const sessionId = CallbackQueryService.createActionSession(
        userId,
        'wallet_withdraw',
        600000, // 10 minutes for withdrawal confirmation
        { amount: userPoints, tokenAmount }
      );

      const keyboard: any[][] = [
        [
          { 
            text: 'Confirm Withdrawal', 
            callback_data: CallbackQueryService.createCallbackDataWithSession(
              'wallet_confirm_withdraw', 
              sessionId
            )
          }
        ],
        [
          { text: 'Cancel', callback_data: 'wallet_show' }
        ]
      ];

      await ctx.editMessageText(confirmationText, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error processing automatic withdrawal:', error);
      await ctx.reply('❌ Error processing withdrawal request. Please try again.');
    }
  }

  /**
   * Execute withdrawal with WalletConnect signature
   */
  async executeWithdrawal(ctx: Context, userId: string): Promise<void> {
    // Track any submitted transaction hash for better error reporting
    let submittedTxHash: string | null = null;
    try {
      // The userId parameter comes from the session which was created by the same user
      // So we don't need to double-check authorization here
      // The session validation already ensures the request is from the correct user

      await CallbackQueryService.safeAnswerCallback(ctx, '🔄 Processing withdrawal...');

      const user = await this.storage.getUser(userId);
      if (!user || !user.walletAddress) {
        await ctx.reply('❌ Wallet not found. Please reconnect your wallet.');
        return;
      }

      // CRITICAL: Re-check channel membership before executing withdrawal
      // User might have left the channel after starting the withdrawal process
      if (this.config.points.requireChannelJoinForWithdrawal && this.config.bot.requiredChannelId) {
        try {
          const channelId = this.normalizeChannelId(this.config.bot.requiredChannelId);
          const member = await ctx.telegram.getChatMember(channelId, parseInt(userId));
          const isJoined = ['member', 'administrator', 'creator'].includes(member.status);
          
          if (!isJoined) {
            await ctx.editMessageText(
              '❌ <b>Channel Join Required</b>\n\n' +
              'You must remain in our Telegram channel to withdraw tokens.\n\n' +
              `Please join: ${channelId}\n\n` +
              'After joining, start the withdrawal process again.',
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'Join Channel', url: `https://t.me/${channelId.replace('@', '')}` }],
                    [{ text: 'Try Again', callback_data: 'wallet_withdraw_auto' }],
                    [{ text: 'Back', callback_data: 'wallet_show' }]
                  ]
                }
              }
            );
            return;
          }
        } catch (error) {
          this.logger.error('Error checking channel membership during withdrawal execution:', error);
          // If channel check fails, deny withdrawal for security (don't continue)
          await ctx.editMessageText(
            '❌ <b>Verification Failed</b>\n\n' +
            'Could not verify your channel membership. Please try again.\n\n' +
            'If the problem persists, contact support.',
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Try Again', callback_data: 'wallet_withdraw_auto' }],
                  [{ text: 'Back', callback_data: 'wallet_show' }]
                ]
              }
            }
          );
          return;
        }
      }

      const withdrawMode = (this.config.wallet as any).withdrawMode || 'claim';
      if (withdrawMode === 'claim') {
        // Require an active WalletConnect session
        const connections = await this.storage.getWalletConnections(userId);
        const activeConnection = connections.find(conn => conn.isActive && conn.walletConnectSession);
        if (!activeConnection || !activeConnection.walletConnectSession) {
          await ctx.editMessageText(
            '❌ <b>Wallet Session Expired</b>\n\n' +
            'Your WalletConnect session has expired. Please reconnect your wallet to continue.',
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Reconnect Wallet', callback_data: 'wallet_connect' }],
                  [{ text: 'Back', callback_data: 'wallet_show' }]
                ]
              }
            }
          );
          return;
        }
        const activeSessions = this.walletConnectService.getActiveSessions();
        const sessionTopic = activeConnection.walletConnectSession.topic;
        if (!activeSessions[sessionTopic]) {
          await this.storage.deactivateWalletConnectionByTopic(sessionTopic);
          // Don't remove walletAddress, just log the session expiry
          await ctx.editMessageText(
            '❌ <b>Wallet Session Invalid</b>\n\n' +
            '🔄 Your wallet connection has been disconnected or expired.\n' +
            '⚡ Please reconnect your wallet to continue with the withdrawal.\n\n' +
            '💡 <b>Tip:</b> Make sure your wallet app is still connected.',
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Reconnect Wallet', callback_data: 'wallet_connect' }],
                  [{ text: 'Back', callback_data: 'wallet_show' }]
                ]
              }
            }
          );
          return;
        }
      }

      // Calculate withdrawal details
      const userPoints = user.points || 0;
      const conversionRate = this.config.points.conversionRate;
      const tokenAmount = userPoints * conversionRate;
      const tokenAmountWei = ethers.utils.parseUnits(tokenAmount.toString(), this.config.wallet.tokenDecimals);

      // Show processing message
      await ctx.editMessageText(
        '⏳ <b>Processing Withdrawal</b>\n\n' +
        '🔄 Creating transaction...\n' +
        '💫 Please check your wallet for signature request\n' +
        '⚡ Do not close this chat',
        { parse_mode: 'HTML' }
      );

      try {
        const withdrawMode = (this.config.wallet as any).withdrawMode || 'claim';
        const base = (this.config.wallet.explorerUrl || '').replace(/\/$/, '');
        if (withdrawMode === 'claim') {
          // Send claim transaction via WalletConnect (user pays gas)
          const { claimFunctionSignature, claimArgsTemplate } = (this.config.wallet as any);
          if (!this.config.wallet.claimContractAddress) {
            throw new Error('Claim contract address not configured');
          }
          if (!claimFunctionSignature) {
            throw new Error('CLAIM_FUNCTION_SIGNATURE not configured');
          }

          // Prepare claim calldata with server-generated signature (ECDSA over keccak256(user, amount, nonce))
          const provider = new ethers.providers.JsonRpcProvider(this.config.wallet.rpcUrl);
          const claimReader = new ethers.Contract(
            this.config.wallet.claimContractAddress,
            ['function lastNonceUsed(address) view returns (uint256)'],
            provider
          );
          
          // Get last nonce from individual mapping function
          let lastNonceUsed;
          try {
            lastNonceUsed = await claimReader.lastNonceUsed(user.walletAddress);
          } catch (nonceError) {
            this.logger.warn('Could not get lastNonceUsed, using 0 as default:', nonceError.message);
            lastNonceUsed = ethers.BigNumber.from(0);
          }
          
          const lastNonce = ethers.BigNumber.from(lastNonceUsed);
          const nextNonce = lastNonce.add(1);

          const signerPk = (this.config.wallet as any).claimSignerPrivateKey || this.config.wallet.privateKey;
          if (!signerPk) throw new Error('CLAIM_SIGNER_PRIVATE_KEY or WALLET_PRIVATE_KEY not configured for claim signing');
          const signer = new ethers.Wallet(signerPk, provider);
          const messageHash = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
              ['address','uint256','uint256'],
              [user.walletAddress, tokenAmountWei, nextNonce]
            )
          );
          const signature = await signer.signMessage(ethers.utils.arrayify(messageHash));

          const data = ClaimService.buildCalldata(
            claimFunctionSignature,
            claimArgsTemplate || 'amount,nonce,signature',
            {
              to: user.walletAddress,
              account: user.walletAddress,
              amountWei: tokenAmountWei,
              nonce: nextNonce,
              signature
            }
          );

          const connections = await this.storage.getWalletConnections(userId);
          const activeConnection = connections.find(conn => conn.isActive && conn.walletConnectSession)!;

          const txHash = await this.walletConnectService.sendTransactionRequest(
            activeConnection.walletConnectSession.topic,
            `eip155:${this.config.wallet.chainId}`,
            {
              from: user.walletAddress,
              to: this.config.wallet.claimContractAddress,
              data,
              value: '0x0'
            }
);

          // save for error reporting
          submittedTxHash = txHash;

          await ctx.editMessageText(
            '⏳ <b>Transaction Submitted</b>\n\n' +
            '🔄 Processing on blockchain...\n' +
            '⏱️ This may take a few moments',
            { parse_mode: 'HTML' }
          );

          // Wait for confirmation using RPC provider
          const confirmations = (this.config.wallet as any).confirmationsToWait || 1;
          const receipt = await provider.waitForTransaction(txHash, confirmations);
          if (!receipt || receipt.status !== 1) {
            throw new Error('Transaction reverted or failed');
          }

          const currentTime = new Date();
          await this.storage.updateUser(userId, {
            points: 0,
            claimed: true,
            claimTimestamp: currentTime.toISOString(),
            transactionHash: txHash,
            nonce: (user.nonce || 0) + 1,
            lastClaimedPoints: userPoints,
            totalClaimedPoints: (user.totalClaimedPoints || 0) + userPoints
          });
          try { (await import('../../shared')).UserValidationService.invalidateSessionUser(ctx); } catch {}

          await this.storage.saveWithdrawalRecord({
            id: `withdrawal_${Date.now()}_${userId}`,
            userId,
            walletAddress: user.walletAddress,
            pointsWithdrawn: userPoints,
            tokenAmount,
            tokenSymbol: this.config.wallet.tokenSymbol,
            transactionHash: txHash,
            status: 'completed',
            requestedAt: new Date(),
            processedAt: new Date(),
            method: 'walletconnect_claim'
          });

          await this.storage.savePointTransaction({
            id: `tx_${Date.now()}_${userId}`,
            userId,
            amount: -userPoints,
            type: 'withdrawal',
            description: 'Claim withdrawal',
            timestamp: new Date(),
            metadata: {
              transactionHash: txHash,
              walletAddress: user.walletAddress,
              tokenAmount,
              tokenSymbol: this.config.wallet.tokenSymbol
            }
          });

          // Send alert to admin channel if configured
          if (this.config.bot.withdrawAlertChannelId) {
            try {
              await TelegramNotifyService.sendWithdrawalAlert(
                this.config.bot.withdrawAlertChannelId,
                userId,
                ctx.from?.username,
                user.walletAddress,
                userPoints,
                tokenAmount,
                this.config.wallet.tokenSymbol,
                txHash,
                this.config.wallet.explorerUrl
              );
            } catch (alertError) {
              this.logger.warn('Failed to send withdrawal alert to channel:', alertError);
            }
          }

          const explorerUrl = base.includes('/tx') ? `${base.replace(/\/?tx\/?$/, '')}/tx/${txHash}` : `${base}/tx/${txHash}`;
          const successText = 
            '🎉 <b>Withdrawal Successful!</b>\n\n' +
            `✅ <b>Transaction Confirmed</b>\n` +
            `🪙 <b>Tokens Sent:</b> ${tokenAmount.toFixed(6)} ${this.config.wallet.tokenSymbol}\n` +
            `💰 <b>Points Used:</b> ${userPoints.toLocaleString()} points\n` +
            `👛 <b>To Wallet:</b> <code>${this.maskWalletAddress(user.walletAddress)}</code>\n\n` +
            `🔍 <b>Transaction Hash:</b>\n<code>${txHash}</code>\n\n` +
            `📊 Your point balance has been reset to 0\n` +
            `🎯 Complete more tasks to earn new points!`;

          await ctx.editMessageText(successText, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'View on Explorer', url: explorerUrl }],
                [{ text: 'Earn More Points', callback_data: 'menu_tasks' }],
                [{ text: 'View Wallet', callback_data: 'wallet_show' }]
              ]
            }
          });
        } else {
          // Server-signed fallback (admin/ops use only)
          const provider = new ethers.providers.JsonRpcProvider(this.config.wallet.rpcUrl);
          const distributor = new ethers.Wallet(this.config.wallet.privateKey, provider);
          const erc20 = new ethers.Contract(
            this.config.wallet.tokenContractAddress,
            ['function transfer(address to, uint256 amount) public returns (bool)'],
            distributor
          );
          const tx = await erc20.transfer(user.walletAddress, tokenAmountWei);
          // save for error reporting
          submittedTxHash = tx.hash;

          await ctx.editMessageText(
            '⏳ <b>Transaction Submitted</b>\n\n' +
            '🔄 Processing on blockchain...\n' +
            '⏱️ This may take a few moments',
            { parse_mode: 'HTML' }
          );
          const receipt = await tx.wait();
          if (!receipt || receipt.status !== 1) {
            throw new Error('Transaction reverted or failed');
          }
          const currentTime = new Date();
          await this.storage.updateUser(userId, {
            points: 0,
            claimed: true,
            claimTimestamp: currentTime.toISOString(),
            transactionHash: tx.hash,
            nonce: (user.nonce || 0) + 1,
            lastClaimedPoints: userPoints,
            totalClaimedPoints: (user.totalClaimedPoints || 0) + userPoints
          });
          try { (await import('../../shared')).UserValidationService.invalidateSessionUser(ctx); } catch {}
          await this.storage.saveWithdrawalRecord({
            id: `withdrawal_${Date.now()}_${userId}`,
            userId,
            walletAddress: user.walletAddress,
            pointsWithdrawn: userPoints,
            tokenAmount,
            tokenSymbol: this.config.wallet.tokenSymbol,
            transactionHash: tx.hash,
            status: 'completed',
            requestedAt: new Date(),
            processedAt: new Date(),
            method: 'server_signed_transfer'
          });
          await this.storage.savePointTransaction({
            id: `tx_${Date.now()}_${userId}`,
            userId,
            amount: -userPoints,
            type: 'withdrawal',
            description: 'Automatic token withdrawal',
            timestamp: new Date(),
            metadata: {
              transactionHash: tx.hash,
              walletAddress: user.walletAddress,
              tokenAmount,
              tokenSymbol: this.config.wallet.tokenSymbol
            }
          });
          
          // Send alert to admin channel if configured
          if (this.config.bot.withdrawAlertChannelId) {
            try {
              await TelegramNotifyService.sendWithdrawalAlert(
                this.config.bot.withdrawAlertChannelId,
                userId,
                ctx.from?.username,
                user.walletAddress,
                userPoints,
                tokenAmount,
                this.config.wallet.tokenSymbol,
                tx.hash,
                this.config.wallet.explorerUrl
              );
            } catch (alertError) {
              this.logger.warn('Failed to send withdrawal alert to channel:', alertError);
            }
          }
          
          const explorerUrl = base.includes('/tx') ? `${base.replace(/\/?tx\/?$/, '')}/tx/${tx.hash}` : `${base}/tx/${tx.hash}`;
          const successText = 
            '🎉 <b>Withdrawal Successful!</b>\n\n' +
            `✅ <b>Transaction Confirmed</b>\n` +
            `🪙 <b>Tokens Sent:</b> ${tokenAmount.toFixed(6)} ${this.config.wallet.tokenSymbol}\n` +
            `💰 <b>Points Used:</b> ${userPoints.toLocaleString()} points\n` +
            `👛 <b>To Wallet:</b> <code>${this.maskWalletAddress(user.walletAddress)}</code>\n\n` +
            `🔍 <b>Transaction Hash:</b>\n<code>${tx.hash}</code>\n\n` +
            `📊 Your point balance has been reset to 0\n` +
            `🎯 Complete more tasks to earn new points!`;
          await ctx.editMessageText(successText, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'View on Explorer', url: explorerUrl }],
                [{ text: 'Earn More Points', callback_data: 'menu_tasks' }],
                [{ text: 'View Wallet', callback_data: 'wallet_show' }]
              ]
            }
          });
        }
      } catch (transactionError: any) {
        const msg = String(transactionError?.message || '');
        const code = (transactionError?.code ?? transactionError?.data?.code ?? transactionError?.error?.code) as any;
        // Try hard to extract a transaction hash from various error shapes and message text
        let txHash = (
          transactionError?.transactionHash ||
          transactionError?.receipt?.transactionHash ||
          transactionError?.hash ||
          transactionError?.transaction?.hash ||
          transactionError?.error?.transactionHash ||
          transactionError?.error?.transaction?.hash ||
          transactionError?.data?.txHash ||
          (typeof msg === 'string' ? (msg.match(/0x[0-9a-fA-F]{64}/)?.[0] || null) : null)
        );
        if (!txHash && submittedTxHash) txHash = submittedTxHash;
        const isRejected =
          code === 4001 ||
          code === 5001 ||
          code === 'ACTION_REJECTED' ||
          /user rejected|rejected|denied|ACTION_REJECTED/i.test(msg);

        if (isRejected) {
          this.logger.warn('Withdrawal cancelled by user', { code });
        } else {
          this.logger.error('Withdrawal failed', { code, error: msg });
        }

        // Record failed withdrawal attempt for audit
        try {
          await this.storage.saveWithdrawalRecord({
            id: `withdrawal_${Date.now()}_${userId}`,
            userId,
            walletAddress: user.walletAddress,
            pointsWithdrawn: userPoints,
            tokenAmount,
            tokenSymbol: this.config.wallet.tokenSymbol,
            transactionHash: txHash || undefined,
            status: 'failed',
            failureReason: msg || 'Transaction failed',
            requestedAt: new Date(),
            processedAt: new Date(),
            method: ((this.config.wallet as any).withdrawMode || 'claim') === 'claim' ? 'walletconnect_claim' : 'server_signed_transfer'
          });
        } catch {}

        let errorMessage = '❌ <b>Withdrawal Failed!</b>\n\n';

        if (isRejected) {
          errorMessage += '🚫 <b>Transaction Cancelled</b>\n';
          errorMessage += `🪙 <b>Tokens Requested:</b> ${tokenAmount.toFixed(6)} ${this.config.wallet.tokenSymbol}\n`;
          errorMessage += `💰 <b>Points to Use:</b> ${userPoints.toLocaleString()} points\n`;
          errorMessage += `👛 <b>To Wallet:</b> <code>${this.maskWalletAddress(user.walletAddress)}</code>\n\n`;
          if (txHash) {
            errorMessage += `🔍 <b>Transaction Hash:</b>\n<code>${txHash}</code>\n\n`;
          }
          errorMessage += `📝 <b>Reason:</b>\nYou cancelled the transaction in your wallet\n\n`;
          errorMessage += `💡 <b>Status:</b> No changes made\n`;
          errorMessage += `📊 Your point balance remains: ${userPoints.toLocaleString()} points`;
        } else if (/insufficient funds/i.test(msg)) {
          const party = ((this.config.wallet as any).withdrawMode || 'claim') === 'claim' ? 'Your wallet' : 'Distribution wallet';
          errorMessage += '💸 <b>Insufficient Gas Balance</b>\n';
          errorMessage += `🪙 <b>Tokens Requested:</b> ${tokenAmount.toFixed(6)} ${this.config.wallet.tokenSymbol}\n`;
          errorMessage += `💰 <b>Points to Use:</b> ${userPoints.toLocaleString()} points\n`;
          errorMessage += `👛 <b>To Wallet:</b> <code>${this.maskWalletAddress(user.walletAddress)}</code>\n\n`;
          if (txHash) {
            errorMessage += `🔍 <b>Transaction Hash:</b>\n<code>${txHash}</code>\n\n`;
          }
          errorMessage += `⛽ <b>Issue:</b>\n${party} needs ETH for gas fees\n\n`;
          errorMessage += `💡 <b>Solution:</b> Add ~0.001 ETH to ${party.toLowerCase()}\n`;
          errorMessage += `📊 Your point balance remains: ${userPoints.toLocaleString()} points`;
        } else if (/execution reverted|ERC20|revert/i.test(msg)) {
          const remainingPoints = (user?.points ?? userPoints ?? 0);
          errorMessage = '⛔️ <b>Withdrawal Failed!</b>\n\n';
          errorMessage += '🚫 <b>Transaction execution reverted</b>\n\n';
          errorMessage += '🔍 <b>Transaction Hash:</b>\n';
          errorMessage += `<code>${txHash || 'not broadcast / unavailable'}</code>\n\n`;
          errorMessage += `📊 Your point balance remains: ${Number(remainingPoints).toLocaleString()} points\n`;
          errorMessage += '🎯 Try again in a few moments!';
        } else if (/nonce|already used/i.test(msg)) {
          errorMessage += '🔄 <b>Duplicate Transaction</b>\n';
          errorMessage += `🪙 <b>Tokens Requested:</b> ${tokenAmount.toFixed(6)} ${this.config.wallet.tokenSymbol}\n`;
          errorMessage += `💰 <b>Points to Use:</b> ${userPoints.toLocaleString()} points\n`;
          errorMessage += `👛 <b>To Wallet:</b> <code>${this.maskWalletAddress(user.walletAddress)}</code>\n\n`;
          if (txHash) {
            errorMessage += `🔍 <b>Transaction Hash:</b>\n<code>${txHash}</code>\n\n`;
          }
          errorMessage += `🔍 <b>Issue:</b>\nThis withdrawal was already processed\n`;
          errorMessage += `📝 <b>Error Code:</b> <code>NONCE_ERR_002</code>\n\n`;
          errorMessage += `📊 Your point balance remains: ${userPoints.toLocaleString()} points\n`;
          errorMessage += `🎯 Request a new withdrawal!`;
        } else {
          const detail = msg ? msg.substring(0, 50) : (code ? `Code: ${code}` : 'Unknown');
          errorMessage += '⚠️ <b>Transaction Error</b>\n';
          errorMessage += `🪙 <b>Tokens Requested:</b> ${tokenAmount.toFixed(6)} ${this.config.wallet.tokenSymbol}\n`;
          errorMessage += `💰 <b>Points to Use:</b> ${userPoints.toLocaleString()} points\n`;
          errorMessage += `👛 <b>To Wallet:</b> <code>${this.maskWalletAddress(user.walletAddress)}</code>\n\n`;
          if (txHash) {
            errorMessage += `🔍 <b>Transaction Hash:</b>\n<code>${txHash}</code>\n\n`;
          }
          errorMessage += `🔍 <b>Error Details:</b>\n${detail}\n`;
          errorMessage += `📝 <b>Error Code:</b> <code>UNKNOWN_ERR_003</code>\n\n`;
          errorMessage += `📊 Your point balance remains: ${userPoints.toLocaleString()} points\n`;
          errorMessage += `🎯 Please try again or contact support!`;
        }

        await ctx.editMessageText(errorMessage, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Try Again', callback_data: 'wallet_withdraw_auto' }],
              [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
            ]
          }
        });
      }

    } catch (error) {
      this.logger.error('Error executing automatic withdrawal:', error);
      await ctx.reply(
        '❌ <b>Withdrawal Error</b>\n\n' +
        'An unexpected error occurred. Please try again later or contact support.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Try Again', callback_data: 'wallet_withdraw_auto' }],
              [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
            ]
          }
        }
      );
    }
  }

  // ============= Private Helper Methods =============

  private getWalletText(user: any): string {
    if (user.walletAddress) {
      const connectionMethod = user.connectionMethod || 'manual';
      const walletName = user.walletName || user.peerName || this.getConnectionMethodName(connectionMethod);

      return `
👛 <b>Your Wallet</b>

✅ <b>Connected Wallet:</b>
📍 Address: <code>${this.maskWalletAddress(user.walletAddress)}</code>
🔗 Type: ${this.detectWalletType(user.walletAddress)}
🌐 Connection: ${walletName}
🟢 Status: Active session

💰 <b>Points Available:</b>
Current Balance: <b>${user.points?.toLocaleString() || '0'}</b>
Minimum Withdrawal: <b>${this.config.points.minWithdraw}</b>

📊 <b>Withdrawal Status:</b>
${(user.points || 0) >= this.config.points.minWithdraw
  ? '✅ You can withdraw your points!' 
  : `❌ Need ${this.config.points.minWithdraw - (user.points || 0)} more points to withdraw`}

🎯 <b>Next Steps:</b>
• Complete more tasks to earn points
• Refer friends for bonus points
• Watch for withdrawal announcements
      `.trim();
    } else {
      return `
👛 <b>Wallet Connection</b>

❌ <b>No Wallet Connected</b>

🔗 Connect your wallet to:
• Receive airdrop rewards
• Access wallet-exclusive tasks
• Increase your security score
• Prepare for token distribution

💡 <b>Connection Methods:</b>
• <b>Wallet Apps:</b> Direct connection via popular wallets
• <b>QR Code:</b> Universal connection method

🔒 <b>Security:</b>
Powered by WalletConnect v2 protocol. Your private keys never leave your wallet. We only store your wallet address for reward distribution.
      `.trim();
    }
  }

  private getWalletKeyboard(user: any): InlineKeyboardMarkup {
    if (user.walletAddress) {
      const keyboard: InlineKeyboardButton[][] = [
        [
          { text: 'Withdraw', callback_data: 'wallet_withdraw' },
          { text: 'Transfer Points', callback_data: 'wallet_transfer' }
        ],
        [
          { text: 'History', callback_data: 'wallet_history' },
          { text: 'Transfer History', callback_data: 'transfer_history' }
        ],
        [
          { text: 'Reconnect Wallet', callback_data: 'wallet_connect' },
          { text: 'Disconnect', callback_data: 'wallet_disconnect' }
        ],
        [
          { text: 'Main Menu', callback_data: 'menu_main' }
        ]
      ];

      return { inline_keyboard: keyboard };
    } else {
      return {
        inline_keyboard: [
          [
            { text: 'Connect Wallet', callback_data: 'wallet_connect' }
          ],
          [
            { text: 'Main Menu', callback_data: 'menu_main' }
          ]
        ]
      };
    }
  }

  private getWithdrawalText(user: any): string {
    const canWithdraw = (user.points || 0) >= this.config.points.minWithdraw;
    
    return `
💸 <b>Withdraw Points</b>

💰 <b>Current Balance:</b> ${(user.points || 0).toLocaleString()} points
💎 <b>Minimum Withdrawal:</b> ${this.config.points.minWithdraw.toLocaleString()} points
👛 <b>Wallet:</b> <code>${this.maskWalletAddress(user.walletAddress)}</code>

${canWithdraw 
  ? '✅ <b>You can withdraw your points!</b>\n\n🎯 Tokens will be sent automatically after blockchain confirmation.' 
  : `❌ <b>Insufficient Balance</b>\n\nYou need ${(this.config.points.minWithdraw - (user.points || 0)).toLocaleString()} more points to withdraw.`}

⚠️ <b>Important:</b>
• Connect your wallet to claim tokens
• Transaction is processed on-chain automatically
• Confirmation depends on blockchain network speed
• Make sure your wallet address is correct

📈 <b>Exchange Rate:</b>
1 point = ${this.config.points.conversionRate || '0.001'} ${this.config.wallet.tokenSymbol || 'tokens'} (estimate)
    `.trim();
  }

  private getWithdrawalKeyboard(user: any): InlineKeyboardMarkup {
    const canWithdraw = (user.points || 0) >= this.config.points.minWithdraw;

    const keyboard: InlineKeyboardButton[][] = [];

    if (canWithdraw) {
      // Create session for withdrawal process with 10-minute timeout
      // Use telegramId instead of userId for consistency
      const sessionId = CallbackQueryService.createActionSession(
        user.telegramId || user.userId,
        'wallet_withdraw_auto',
        600000, // 10 minutes timeout for withdrawal process
        { action: 'withdraw_auto', points: user.points }
      );

      keyboard.push([
        { 
          text: 'Withdraw Tokens', 
          callback_data: CallbackQueryService.createCallbackDataWithSession(
            'wallet_withdraw_auto_session',
            sessionId
          )
        }
      ]);
    }

    keyboard.push([
      { text: 'History', callback_data: 'wallet_history' },
      { text: 'Back', callback_data: 'wallet_show' }
    ]);

    return { inline_keyboard: keyboard };
  }

  private async showWalletHistory(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const connections = await this.storage.getWalletConnections(userId);
      const withdrawals = await this.storage.getWithdrawalRecords(userId);

      let historyText = '📊 <b>Wallet History</b>\n\n';

      // Show connections
      if (connections.length > 0) {
        historyText += '<b>🔗 Connections:</b>\n';
        connections.slice(-5).forEach(conn => {
          const date = DateUtils.formatUserDate(DateUtils.parseUserDate(conn.connectedAt));
          const status = conn.isActive ? '✅ Active' : '❌ Inactive';
          const method = this.getConnectionMethodName(conn.metadata?.connectionMethod);
          historyText += `• ${date}: ${this.maskWalletAddress(conn.walletAddress)} (${method}, ${status})\n`;
        });
        historyText += '\n';
      }

      // Show withdrawals
      if (withdrawals.length > 0) {
        historyText += '<b>💸 Withdrawals:</b>\n';
        withdrawals.slice(-5).forEach(withdrawal => {
          const date = withdrawal.requestedAt ? DateUtils.formatUserDate(DateUtils.parseUserDate(withdrawal.requestedAt)) : 'Unknown';
          const points = withdrawal.pointsWithdrawn || withdrawal.amount || 0;
          const status = withdrawal.status || 'unknown';
          const tokenAmount = withdrawal.tokenAmount ? ` (${withdrawal.tokenAmount.toFixed(6)} ${withdrawal.tokenSymbol || 'tokens'})` : '';
          historyText += `• ${date}: ${points.toLocaleString()} points${tokenAmount} - ${status}\n`;
        });
      } else {
        historyText += '<b>💸 Withdrawals:</b>\nNo withdrawals yet.';
      }

      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: [
          [
            { text: 'Withdraw', callback_data: 'wallet_withdraw' },
            { text: 'Refresh', callback_data: 'wallet_history' }
          ],
          [
            { text: 'Back to Wallet', callback_data: 'wallet_show' }
          ]
        ]
      };

      await ctx.editMessageText(historyText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing wallet history:', error);
      await ctx.reply('❌ Error loading wallet history.');
    }
  }

  private async handleWalletDisconnection(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Create session for wallet disconnection confirmation with 5-minute timeout
      const sessionId = CallbackQueryService.createActionSession(
        userId,
        'wallet_disconnect',
        300000, // 5 minutes timeout for disconnection confirmation
        { action: 'disconnect' }
      );

      // Get user data to show warning about wallet lock
      const userData = await this.storage.getUser(userId);
      const originalWallet = userData?.previousWallet || userData?.walletAddress;
      
      await ctx.editMessageText(
        '⚠️ <b>Disconnect Wallet Session</b>\n\n' +
        'Are you sure you want to disconnect your current wallet session?\n\n' +
        '💡 <b>What happens:</b>\n' +
        '• Your WalletConnect session will be terminated\n' +
        '• You\'ll need to reconnect to withdraw rewards\n' +
        `• You can only reconnect your registered wallet:\n  <code>${this.maskWalletAddress(originalWallet || 'None')}</code>\n\n` +
        '⚠️ <b>Important:</b>\n' +
        'You CANNOT connect a different wallet address. Only your original wallet can be reconnected for security reasons.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: '❌ Yes, Disconnect', 
                  callback_data: CallbackQueryService.createCallbackDataWithSession(
                    'wallet_disconnect_confirm',
                    sessionId
                  )
                },
                { text: 'Cancel', callback_data: 'wallet_show' }
              ]
            ]
          }
        }
      );

    } catch (error) {
      this.logger.error('Error handling wallet disconnection:', error);
      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Error processing disconnection request');
    }
  }

  private async confirmWalletDisconnection(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Get user's wallet connections
      const connections = await this.storage.getWalletConnections(userId);
      
      // Disconnect WalletConnect sessions
      for (const connection of connections) {
        if (connection.walletConnectSession) {
          try {
            await this.walletConnectService.disconnectSession(
              connection.walletConnectSession.topic,
              'User disconnected wallet'
            );
          } catch (error) {
            this.logger.warn('Failed to disconnect WalletConnect session:', error);
          }
        }
      }

      // Keep wallet address but mark disconnection time
      await this.storage.updateUser(userId, {
        walletDisconnectedAt: new Date().toISOString()
      });
      try { (await import('../../shared')).UserValidationService.invalidateSessionUser(ctx); } catch {}

      // Deactivate all connections
      for (const connection of connections) {
        await this.storage.deactivateWalletConnectionByTopic(connection.sessionId || '');
      }

      // Get user data to show their original wallet
      const userData = await this.storage.getUser(userId);
      const originalWallet = userData?.previousWallet || userData?.walletAddress;
      
      await ctx.editMessageText(
        '✅ <b>Wallet Session Disconnected</b>\n\n' +
        '🔌 Your wallet session has been disconnected.\n\n' +
        '• All WalletConnect sessions terminated\n' +
        '• Current connection removed\n' +
        `• Your registered wallet: <code>${this.maskWalletAddress(originalWallet || 'None')}</code>\n\n` +
        '🔒 <b>Security Note:</b>\n' +
        'You can only reconnect your original wallet. This ensures fair distribution and prevents abuse.\n\n' +
        'Thank you for using our bot!',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Reconnect Wallet', callback_data: 'wallet_connect' }],
              [{ text: 'Main Menu', callback_data: 'menu_main' }]
            ]
          }
        }
      );

      this.logger.info('Wallet disconnected successfully', { userId });

    } catch (error) {
      this.logger.error('Error confirming wallet disconnection:', error);
      await ctx.reply('❌ Error disconnecting wallet. Please try again.');
    }
  }

  private maskWalletAddress(address: string): string {
    if (!address || address.length <= 10) return address || 'Unknown';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  private isValidWalletAddress(address: string): boolean {
    return isEthereumAddress(address) || 
           isBitcoinAddress(address) || 
           isSolanaAddress(address) || 
           isTonAddress(address);
  }

  private detectWalletType(address: string): WalletType {
    if (isEthereumAddress(address)) return 'ethereum';
    if (isBitcoinAddress(address)) return 'bitcoin';
    if (isSolanaAddress(address)) return 'solana';
    if (isTonAddress(address)) return 'ton';
    return 'unknown';
  }

  private getWalletTypeName(type: WalletType): string {
    const names: Record<WalletType, string> = {
      metamask: 'MetaMask',
      trust: 'Trust Wallet',
      coinbase: 'Coinbase Wallet',
      rainbow: 'Rainbow',
      bitget: 'Bitget Wallet',
      phantom: 'Phantom',
      exodus: 'Exodus',
      atomic: 'Atomic Wallet',
      safepal: 'SafePal',
      tokenpocket: 'TokenPocket',
      imtoken: 'imToken',
      oneinch: '1inch Wallet',
      mathwallet: 'Math Wallet',
      alphaWallet: 'AlphaWallet',
      zerion: 'Zerion',
      pillar: 'Pillar',
      walletconnect: 'WalletConnect',
      manual: 'Manual Entry',
      ethereum: 'Ethereum',
      bitcoin: 'Bitcoin',
      solana: 'Solana',
      ton: 'TON',
      unknown: 'Unknown'
    };

    return names[type] || 'Unknown';
  }

  private getConnectionMethodName(method: string): string {
    const methods: Record<string, string> = {
      walletconnect: 'WalletConnect',
      qr_code: 'QR Code',
      deep_link: 'Wallet App',
      manual_entry: 'Manual Entry',
      browser_extension: 'Browser Extension'
    };

    return methods[method] || 'Unknown';
  }

  // Wallet connection bonus system removed per user request

  // ===== TRANSFER METHODS =====

  /**
   * Show transfer menu with options
   */
  async showTransferMenu(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Check if transfers are enabled
      if (!this.config.points.transfer.enabled) {
        await ctx.editMessageText(
          '❌ <b>Transfer Disabled</b>\n\n' +
          'Point transfers are currently disabled by the administrator.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
              ]
            }
          }
        );
        return;
      }

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      // Check daily transfer limits
      const today = new Date();
      const dailyCount = await this.storage.getDailyTransferCount(userId, today);
      const dailyAmount = await this.storage.getDailyTransferAmount(userId, today);

      const canTransfer = dailyCount < this.config.points.transfer.dailyLimit &&
                         user.points >= this.config.points.transfer.minAmount;

      const transferMenuText = 
        '📈 <b>Points Transfer Center</b>\n\n' +
        '💰 <b>Your Balance:</b> ' + formatPoints(user.points || 0) + ' points\n' +
        '🔄 <b>Daily Transfers Used:</b> ' + dailyCount + '/' + this.config.points.transfer.dailyLimit + '\n' +
        '📉 <b>Daily Amount Transferred:</b> ' + formatPoints(dailyAmount) + ' points\n\n' +
        '💸 <b>Transfer Limits:</b>\n' +
        '• <b>Minimum:</b> ' + formatPoints(this.config.points.transfer.minAmount) + ' points\n' +
        '• <b>Maximum:</b> ' + formatPoints(this.config.points.transfer.maxAmount) + ' points\n' +
        '• <b>Daily Limit:</b> ' + formatPoints(this.config.points.transfer.maxDailyAmount) + ' points\n' +
        '• <b>Transfer Fee:</b> ' + this.config.points.transfer.feePercentage + '%\n\n' +
        (canTransfer 
          ? '✅ <b>Ready to transfer!</b> Send points to other users instantly.' 
          : '❌ <b>Cannot transfer:</b> ' + 
            (dailyCount >= this.config.points.transfer.dailyLimit ? 'Daily limit reached' :
             user.points < this.config.points.transfer.minAmount ? 'Insufficient balance' : 'Unknown error'));

      const keyboard: InlineKeyboardButton[][] = [];

      if (canTransfer) {
        keyboard.push([
          { text: 'Start Transfer', callback_data: 'transfer_start' }
        ]);
      }

      keyboard.push([
        { text: 'Transfer History', callback_data: 'transfer_history' },
        { text: 'Back to Wallet', callback_data: 'wallet_show' }
      ]);

      await ctx.editMessageText(transferMenuText, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });

    } catch (error) {
      this.logger.error('Error showing transfer menu:', error);
      await ctx.reply('❌ Error loading transfer menu.');
    }
  }

  /**
   * Start transfer process - ask for recipient
   */
  async startTransferProcess(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Create a transfer session to track the process
      const transferSession = {
        id: generateTransferId(userId, 'pending'),
        senderId: userId,
        step: 'recipient',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
      };

      // Save transfer session (we can use a simple in-memory store or file)
      await this.saveTransferSession(transferSession);

      const instructionText = 
        '🎯 <b>Step 1: Enter Recipient</b>\n\n' +
        '👤 <b>How to send:</b>\n' +
        '• User ID: <code>123456789</code>\n' +
        '• Username: <code>@username</code> or <code>username</code>\n\n' +
        '📝 <b>Please send the recipient information as your next message.</b>\n\n' +
        '🕰️ <b>Session expires in 5 minutes</b>';

      await ctx.editMessageText(instructionText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Cancel Transfer', callback_data: 'wallet_transfer' }]
          ]
        }
      });

    } catch (error) {
      this.logger.error('Error starting transfer process:', error);
      await ctx.reply('❌ Error starting transfer.');
    }
  }

  /**
   * Process transfer recipient input
   */
  async processTransferRecipient(ctx: Context, recipientInput: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Parse recipient input
      const { type, value } = parseRecipientInput(recipientInput);
      
      // Find recipient user
      const recipient = await this.findUserByInput(type, value);
      
      if (!recipient.found || !recipient.user) {
        await ctx.reply(
          '❌ <b>Recipient Not Found</b>\n\n' +
          'Could not find a user with that ID or username.\n' +
          'Please check and try again.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Try Again', callback_data: 'transfer_start' }],
                [{ text: 'Cancel', callback_data: 'wallet_transfer' }]
              ]
            }
          }
        );
        return;
      }

      // Check if trying to send to self
      if (recipient.user.id === userId) {
        await ctx.reply(
          '❌ <b>Invalid Recipient</b>\n\n' +
          'You cannot transfer points to yourself.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Try Again', callback_data: 'transfer_start' }],
                [{ text: 'Cancel', callback_data: 'wallet_transfer' }]
              ]
            }
          }
        );
        return;
      }

      // Update transfer session with recipient
      const transferSession = await this.getTransferSession(userId);
      if (!transferSession) {
        await ctx.reply('❌ Transfer session expired. Please start again.');
        return;
      }

      transferSession.receiverId = recipient.user.id;
      transferSession.receiverUsername = recipient.user.username;
      transferSession.step = 'amount';
      await this.saveTransferSession(transferSession);

      // Ask for amount
      const amountText = 
        '🎯 <b>Step 2: Enter Amount</b>\n\n' +
        '👤 <b>Recipient:</b> ' + (recipient.user.displayName || recipient.user.username || recipient.user.id) + '\n\n' +
        '💰 <b>Enter transfer amount:</b>\n' +
        '• <b>Minimum:</b> ' + formatPoints(this.config.points.transfer.minAmount) + ' points\n' +
        '• <b>Maximum:</b> ' + formatPoints(this.config.points.transfer.maxAmount) + ' points\n' +
        '• <b>Transfer Fee:</b> ' + this.config.points.transfer.feePercentage + '%\n\n' +
        '📝 <b>Please send the amount as your next message.</b>';

      await ctx.reply(amountText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Cancel Transfer', callback_data: 'wallet_transfer' }]
          ]
        }
      });

    } catch (error) {
      this.logger.error('Error processing transfer recipient:', error);
      await ctx.reply('❌ Error processing recipient.');
    }
  }

  /**
   * Process transfer amount input
   */
  async processTransferAmount(ctx: Context, amountInput: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const transferSession = await this.getTransferSession(userId);
      if (!transferSession || transferSession.step !== 'amount') {
        await ctx.reply('❌ Transfer session invalid. Please start again.');
        return;
      }

      // Parse amount
      const amount = parseInt(amountInput.replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply(
          '❌ <b>Invalid Amount</b>\n\n' +
          'Please enter a valid number of points.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Try Again', callback_data: 'transfer_start' }],
                [{ text: 'Cancel', callback_data: 'wallet_transfer' }]
              ]
            }
          }
        );
        return;
      }

      // Get sender data
      const sender = await this.storage.getUser(userId);
      if (!sender) {
        await ctx.reply('❌ Sender not found.');
        return;
      }

      // Validate amount
      const validation = validateTransferAmount(
        amount, 
        sender.points || 0, 
        this.config.points.transfer.minAmount, 
        this.config.points.transfer.maxAmount
      );

      if (!validation.isValid) {
        await ctx.reply(
          '❌ <b>Invalid Amount</b>\n\n' + validation.error,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Try Again', callback_data: 'transfer_start' }],
                [{ text: 'Cancel', callback_data: 'wallet_transfer' }]
              ]
            }
          }
        );
        return;
      }

      // Calculate fee (deducted from transfer amount)
      const fee = calculateTransferFee(amount, this.config.points.transfer.feePercentage);
      const netAmount = amount - fee;  // Receiver gets amount minus fee
      const totalDeduct = amount;       // Sender loses the full amount

      // Check if sender has enough balance including fee
      if (totalDeduct > sender.points) {
        await ctx.reply(
          '❌ <b>Insufficient Balance</b>\n\n' +
          '💰 <b>Required:</b> ' + formatPoints(totalDeduct) + ' points\n\n' +
          '💳 <b>Your Balance:</b> ' + formatPoints(sender.points) + ' points',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Try Again', callback_data: 'transfer_start' }],
                [{ text: 'Cancel', callback_data: 'wallet_transfer' }]
              ]
            }
          }
        );
        return;
      }

      // Update transfer session
      transferSession.amount = amount;
      transferSession.fee = fee;
      transferSession.netAmount = netAmount;
      transferSession.totalDeduct = totalDeduct;
      transferSession.step = 'confirm';
      await this.saveTransferSession(transferSession);

      // Get recipient info
      const recipient = await this.storage.getUser(transferSession.receiverId!);
      
      // Show confirmation
      await this.showTransferConfirmation(ctx, transferSession, sender, recipient);

    } catch (error) {
      this.logger.error('Error processing transfer amount:', error);
      await ctx.reply('❌ Error processing amount.');
    }
  }

  /**
   * Show transfer confirmation
   */
  async showTransferConfirmation(ctx: Context, transferSession: any, sender: any, recipient: any): Promise<void> {
    try {
      const hash = generateTransferHash(transferSession.senderId, transferSession.receiverId, transferSession.amount);
      transferSession.hash = hash;
      await this.saveTransferSession(transferSession);

      const confirmationText = 
        '📋 <b>Transfer Confirmation</b>\n\n' +
        '👤 <b>From:</b> ' + (sender.username || sender.firstName || 'You') + '\n' +
        '👥 <b>To:</b> ' + (recipient?.username || recipient?.firstName || transferSession.receiverId) + '\n\n' +
        '💰 <b>Transfer Details:</b>\n' +
        '• <b>Amount to Send:</b> ' + formatPoints(transferSession.amount) + ' points\n' +
        '• <b>Transfer Fee (' + this.config.points.transfer.feePercentage + '%):</b> ' + formatPoints(transferSession.fee) + ' points (deducted from amount)\n' +
        '• <b>Recipient Receives:</b> ' + formatPoints(transferSession.netAmount) + ' points\n\n' +
        '🔗 <b>Transaction Hash:</b>\n<code>' + formatTransferHash(hash) + '</code>\n\n' +
        'ℹ️ <b>Remaining Balance:</b> ' + formatPoints((sender.points || 0) - transferSession.totalDeduct) + ' points\n\n' +
        '⚠️ <b>This action cannot be undone!</b>';

      // Create session for transfer confirmation with 5-minute timeout
      const confirmSessionId = CallbackQueryService.createActionSession(
        transferSession.senderId,
        'transfer_process',
        300000, // 5 minutes timeout for transfer confirmation
        { action: 'confirm', transferId: transferSession.id }
      );

      const cancelSessionId = CallbackQueryService.createActionSession(
        transferSession.senderId,
        'transfer_cancel',
        300000, // 5 minutes timeout for transfer cancellation
        { action: 'cancel', transferId: transferSession.id }
      );

      await ctx.reply(confirmationText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { 
                text: 'Confirm Transfer', 
                callback_data: CallbackQueryService.createCallbackDataWithSession(
                  'transfer_confirm',
                  confirmSessionId,
                  [transferSession.id]
                )
              }
            ],
            [
              { 
                text: '❌ Cancel Transfer', 
                callback_data: CallbackQueryService.createCallbackDataWithSession(
                  'transfer_cancel',
                  cancelSessionId,
                  [transferSession.id]
                )
              }
            ]
          ]
        }
      });

    } catch (error) {
      this.logger.error('Error showing transfer confirmation:', error);
      await ctx.reply('❌ Error showing confirmation.');
    }
  }

  /**
   * Confirm and execute transfer
   */
  async confirmTransfer(ctx: Context, transferId: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      await CallbackQueryService.safeAnswerCallback(ctx, '🔄 Processing transfer...');

      const transferSession = await this.getTransferSession(userId);
      if (!transferSession || transferSession.id !== transferId || transferSession.step !== 'confirm') {
        await ctx.editMessageText('❌ Transfer session invalid or expired.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
            ]
          }
        });
        return;
      }

      await CallbackQueryService.safeAnswerCallback(ctx, '🔄 Processing transfer...');

      // Get latest user data
      const sender = await this.storage.getUser(userId);
      const recipient = await this.storage.getUser(transferSession.receiverId!);

      if (!sender || !recipient) {
        await ctx.editMessageText('❌ Transfer failed: User not found.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
            ]
          }
        });
        return;
      }

      // Final validation
      if (sender.points < transferSession.totalDeduct) {
        await ctx.editMessageText('❌ Transfer failed: Insufficient balance.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
            ]
          }
        });
        return;
      }

      // Execute transfer
      const now = new Date().toISOString();
      
      // Update balances
      await this.storage.updateUser(userId, {
        points: sender.points - transferSession.totalDeduct
      });
      
      await this.storage.updateUser(transferSession.receiverId!, {
        points: (recipient.points || 0) + transferSession.netAmount
      });

      // Create transfer record
      const transferRecord: TransferRecord = {
        id: transferSession.id,
        hash: transferSession.hash,
        senderId: userId,
        senderUsername: sender.username,
        receiverId: transferSession.receiverId!,
        receiverUsername: recipient.username,
        amount: transferSession.amount,
        fee: transferSession.fee,
        netAmount: transferSession.netAmount,
        status: 'completed',
        type: 'user_to_user',
        createdAt: now,
        processedAt: now
      };

      await this.storage.saveTransferRecord(transferRecord);

      // Send alert to admin channel if configured
      if (this.config.bot.withdrawAlertChannelId) {
        try {
          await TelegramNotifyService.sendTransferAlert(
            this.config.bot.withdrawAlertChannelId,
            userId,
            sender.username,
            transferSession.receiverId!,
            recipient.username,
            transferSession.amount,
            transferSession.fee,
            transferSession.netAmount,
            transferSession.hash
          );
        } catch (alertError) {
          this.logger.warn('Failed to send transfer alert to channel:', alertError);
        }
      }

      // Log point transactions
      await this.storage.savePointTransaction({
        id: `tx_${Date.now()}_${userId}_transfer_sent_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type: 'transfer_sent',
        amount: -transferSession.totalDeduct,
        source: 'system',
        description: `Transfer to ${recipient.username || transferSession.receiverId} (${formatPoints(transferSession.amount)} + ${formatPoints(transferSession.fee)} fee)`,
        timestamp: new Date(),
        createdAt: now,
        metadata: {
          transferId: transferSession.id,
          receiverId: transferSession.receiverId,
          originalAmount: transferSession.amount,
          fee: transferSession.fee
        }
      });

      await this.storage.savePointTransaction({
        id: `tx_${Date.now()}_${transferSession.receiverId}_transfer_received_${Math.random().toString(36).substr(2, 9)}`,
        userId: transferSession.receiverId!,
        type: 'transfer_received',
        amount: transferSession.netAmount,
        source: 'system',
        description: `Transfer from ${sender.username || userId}`,
        timestamp: new Date(),
        createdAt: now,
        metadata: {
          transferId: transferSession.id,
          senderId: userId,
          netAmount: transferSession.netAmount
        }
      });

      // Clean up transfer session
      await this.clearTransferSession(userId);

      // Show success message
      const successText = createTransferNotificationMessage(
        'sent',
        transferSession.amount,
        recipient.username || transferSession.receiverId!,
        transferSession.hash,
        transferSession.fee
      );

      await ctx.editMessageText(successText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'View History', callback_data: 'transfer_history' }],
            [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
          ]
        }
      });

      // Notify recipient
      try {
        const recipientNotification = createTransferNotificationMessage(
          'received',
          transferSession.netAmount,
          sender.username || userId,
          transferSession.hash
        );

        await ctx.telegram.sendMessage(transferSession.receiverId!, recipientNotification, {
          parse_mode: 'HTML'
        });
      } catch (notificationError) {
        this.logger.warn('Could not notify recipient:', notificationError);
      }

      this.logger.info('Transfer completed successfully:', {
        hash: transferSession.hash,
        from: userId,
        to: transferSession.receiverId,
        amount: transferSession.amount,
        fee: transferSession.fee
      });

    } catch (error) {
      this.logger.error('Error confirming transfer:', error);
      await ctx.reply('❌ Transfer failed. Please try again.');
    }
  }

  /**
   * Cancel transfer
   */
  async cancelTransfer(ctx: Context, transferId: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Transfer cancelled');
      await this.clearTransferSession(userId);

      await ctx.editMessageText(
        '❌ <b>Transfer Cancelled</b>\n\n' +
        'Your transfer has been cancelled successfully.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'New Transfer', callback_data: 'wallet_transfer' }],
              [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
            ]
          }
        }
      );

    } catch (error) {
      this.logger.error('Error cancelling transfer:', error);
    }
  }

  /**
   * Show transfer history
   */
  async showTransferHistory(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const transfers = await this.storage.getTransferRecords(userId);
      const sentTransfers = transfers.filter(t => t.senderId === userId);
      const receivedTransfers = transfers.filter(t => t.receiverId === userId);

      let historyText = '📈 <b>Transfer History</b>\n\n';

      if (transfers.length === 0) {
        historyText += '📋 <b>No transfers yet</b>\n\n' +
                      'You haven\'t made or received any point transfers.';
      } else {
        // Recent transfers (last 10)
        const recentTransfers = transfers
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10);

        historyText += '📉 <b>Recent Transfers:</b>\n\n';

        for (const transfer of recentTransfers) {
          const date = DateUtils.formatUserDate(DateUtils.parseUserDate(transfer.createdAt));
          const isSent = transfer.senderId === userId;
          const icon = isSent ? '💸' : '📈';
          const direction = isSent ? 'Sent' : 'Received';
          const otherUser = isSent 
            ? (transfer.receiverUsername || transfer.receiverId)
            : (transfer.senderUsername || transfer.senderId);
          const amount = isSent ? transfer.amount : transfer.netAmount;
          
          historyText += `${icon} <b>${direction}:</b> ${formatPoints(amount)} pts\n`;
          historyText += `• ${isSent ? 'To' : 'From'}: ${otherUser}\n`;
          historyText += `• Date: ${date}\n`;
          historyText += `• Hash: <code>${formatTransferHash(transfer.hash)}</code>\n\n`;
        }

        // Summary stats
        const totalSent = sentTransfers.reduce((sum, t) => sum + t.amount + t.fee, 0);
        const totalReceived = receivedTransfers.reduce((sum, t) => sum + t.netAmount, 0);
        
        historyText += '📅 <b>Summary:</b>\n';
        historyText += `• Transfers Sent: ${sentTransfers.length} (${formatPoints(totalSent)} pts)\n`;
        historyText += `• Transfers Received: ${receivedTransfers.length} (${formatPoints(totalReceived)} pts)`;
      }

      await ctx.editMessageText(historyText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'New Transfer', callback_data: 'wallet_transfer' }],
            [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
          ]
        }
      });

    } catch (error) {
      this.logger.error('Error showing transfer history:', error);
      await ctx.reply('❌ Error loading transfer history.');
    }
  }

  /**
   * Handle text messages for transfer process
   */
  async handleTransferMessage(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Check if user has an active transfer session
      const transferSession = await this.getTransferSession(userId);
      if (!transferSession) {
        // No active transfer session, ignore this message
        return;
      }

      const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      if (!messageText) return;

      // Handle based on current step
      switch (transferSession.step) {
        case 'recipient':
          await this.processTransferRecipient(ctx, messageText.trim());
          break;
        case 'amount':
          await this.processTransferAmount(ctx, messageText.trim());
          break;
        default:
          // Invalid step, clear session
          await this.clearTransferSession(userId);
          await ctx.reply(
            '❌ <b>Transfer Session Error</b>\n\n' +
            'Your transfer session has expired or encountered an error.\n' +
            'Please start a new transfer.',
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Start New Transfer', callback_data: 'transfer_start' }],
                  [{ text: 'Back to Wallet', callback_data: 'wallet_show' }]
                ]
              }
            }
          );
          break;
      }

    } catch (error) {
      this.logger.error('Error handling transfer message:', error);
    }
  }

  /**
   * Check if user has active transfer session
   */
  async hasActiveTransferSession(userId: string): Promise<boolean> {
    try {
      const session = await this.getTransferSession(userId);
      return !!session && (session.step === 'recipient' || session.step === 'amount');
    } catch (error) {
      return false;
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Find user by ID or username
   */
  private async findUserByInput(type: 'id' | 'username', value: string): Promise<UserLookupResult> {
    try {
      if (type === 'id') {
        const user = await this.storage.getUser(value);
        if (user) {
          return {
            found: true,
            user: {
              id: user.telegramId || value,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              displayName: user.username || user.firstName || `User ${value}`
            }
          };
        }
      } else {
        const user = await this.storage.getUserByUsername(value);
        if (user) {
          return {
            found: true,
            user: {
              id: user.telegramId || user.id,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              displayName: user.username || user.firstName || `User ${user.telegramId || user.id}`
            }
          };
        }
      }

      return { found: false, error: 'User not found' };
    } catch (error) {
      this.logger.error('Error finding user:', error);
      return { found: false, error: 'Search error' };
    }
  }

  /**
   * Save transfer session
   */
  private async saveTransferSession(session: any): Promise<void> {
    try {
      await this.storage.set('transfer_sessions', session, session.senderId);
    } catch (error) {
      this.logger.error('Error saving transfer session:', error);
    }
  }

  /**
   * Get transfer session
   */
  async getTransferSession(userId: string): Promise<any | null> {
    try {
      const session = await this.storage.get<any>('transfer_sessions', userId);
      if (!session) return null;
      if (new Date() > new Date(session.expiresAt)) {
        await this.clearTransferSession(userId);
        return null;
      }
      return session;
    } catch (error) {
      this.logger.error('Error getting transfer session:', error);
      return null;
    }
  }

  /**
   * Clear transfer session
   */
  private async clearTransferSession(userId: string): Promise<void> {
    try {
      await this.storage.delete('transfer_sessions', userId);
    } catch (error) {
      this.logger.error('Error clearing transfer session:', error);
    }
  }
}