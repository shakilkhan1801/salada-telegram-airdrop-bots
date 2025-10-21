import { Context } from 'telegraf';
import { Logger } from '../logger';
import { getConfig } from '../../config';
import { StorageManager } from '../../storage';
import { CaptchaService } from '../captcha-service';
import { ICaptchaValidationService, IUserRegistrationService } from '../../interfaces/bot-services.interface';
import { Container } from '../container.service';
import { TYPES } from '../../interfaces/container.interface';
import { UserFactory } from '../../factories/user-factory';
import { MenuHandler } from '../../bot/handlers/menu-handler';
import { referralManager } from '../referral-manager.service';

export class CaptchaValidationService implements ICaptchaValidationService {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage = StorageManager.getInstance();
  private readonly captchaService = CaptchaService.getInstance();
  private readonly container = Container.getInstance();

  // Handler - TODO: Should be injected through container
  private readonly menuHandler = new MenuHandler();

  async shouldRequireCaptcha(user: any, isNewUser: boolean): Promise<boolean> {
    const captchaConfig = this.config.captcha;
    
    // Professional 2-Tier Logic: If both disabled → return false (no captcha needed)
    const anyCaptchaEnabled = captchaConfig.miniappEnabled || captchaConfig.svgEnabled;
    if (!anyCaptchaEnabled) {
      this.logger.info('No captcha required - all captcha types disabled', { 
        miniappEnabled: captchaConfig.miniappEnabled, 
        svgEnabled: captchaConfig.svgEnabled 
      });
      return false;
    }
    
    // New user requirements - always require verification if any captcha enabled
    if (isNewUser) {
      this.logger.info('Captcha required for new user', { 
        miniappEnabled: captchaConfig.miniappEnabled, 
        svgEnabled: captchaConfig.svgEnabled 
      });
      return true;
    }
    
    // Existing user requirements
    if (!user) {
      this.logger.warn('shouldRequireCaptcha called with null user for existing user check');
      return false;
    }
    
    // CRITICAL: Check if user has incomplete verification regardless of block status
    // This handles unblocked users who had their verification reset
    const hasIncompleteVerification = !user.miniappVerified || !user.svgCaptchaVerified;
    
    // IMPORTANT: Blocked users OR users with incomplete verification must complete captcha
    if (user.isBlocked || hasIncompleteVerification) {
      const needsVerification = (captchaConfig.miniappEnabled && !user.miniappVerified) || 
                                (captchaConfig.svgEnabled && !user.svgCaptchaVerified);
      
      this.logger.info('User captcha requirement check', {
        userId: user.telegramId,
        isBlocked: user.isBlocked,
        hasIncompleteVerification,
        needsVerification,
        miniappEnabled: captchaConfig.miniappEnabled,
        miniappVerified: user.miniappVerified,
        svgEnabled: captchaConfig.svgEnabled,
        svgVerified: user.svgCaptchaVerified
      });
      
      return needsVerification;
    }
    
    // Check if existing users need captcha (based on environment config)
    // This only applies to fully verified users
    if (!captchaConfig.forExistingUsers) {
      this.logger.debug('Captcha not required for fully verified existing users per configuration', { userId: user.telegramId });
      return false;
    }
    
    // Professional Sequential Logic: If any enabled and not completed → return true
    let needsVerification = false;
    
    // Check MiniApp verification status
    if (captchaConfig.miniappEnabled && !user.miniappVerified) {
      needsVerification = true;
      this.logger.debug('MiniApp captcha verification needed', { userId: user.telegramId });
    }
    
    // Check SVG verification status
    if (captchaConfig.svgEnabled && !user.svgCaptchaVerified) {
      needsVerification = true;
      this.logger.debug('SVG captcha verification needed', { userId: user.telegramId });
    }
    
    this.logger.info('Captcha requirement determination', {
      userId: user.telegramId,
      needsVerification,
      miniappEnabled: captchaConfig.miniappEnabled,
      miniappVerified: user.miniappVerified,
      svgEnabled: captchaConfig.svgEnabled,
      svgVerified: user.svgCaptchaVerified
    });
    
    return needsVerification;
  }

  async getNextCaptchaType(userId: string): Promise<'miniapp' | 'svg' | null> {
    const captchaConfig = this.config.captcha;
    const user = await this.storage.getUser(userId);
    
    // Professional Sequential Flow Implementation:
    // Priority order: MiniApp → SVG (as per requirements)
    
    const miniappEnabled = captchaConfig.miniappEnabled;
    const miniappCompleted = user?.miniappVerified || false;
    const svgEnabled = captchaConfig.svgEnabled;
    const svgCompleted = user?.svgCaptchaVerified || false;
    
    // Sequential logic: If both enabled: show MiniApp first, then SVG
    if (miniappEnabled && !miniappCompleted) {
      this.logger.info('Next captcha: MiniApp (Step 1)', { 
        userId, 
        bothEnabled: miniappEnabled && svgEnabled 
      });
      return 'miniapp';
    }
    
    // After MiniApp completion OR if only SVG enabled
    if (svgEnabled && !svgCompleted) {
      this.logger.info('Next captcha: SVG', { 
        userId, 
        isStep2: miniappEnabled && miniappCompleted,
        onlyStep: !miniappEnabled 
      });
      return 'svg';
    }
    
    // All required captchas completed
    this.logger.info('All captchas completed', { 
      userId,
      miniappEnabled,
      miniappCompleted,
      svgEnabled,
      svgCompleted 
    });
    return null;
  }

  async hasCompletedAllCaptchas(userId: string): Promise<boolean> {
    const captchaConfig = this.config.captcha;
    const user = await this.storage.getUser(userId);
    
    if (!user) {
      this.logger.warn('hasCompletedAllCaptchas called with non-existent user', { userId });
      return false;
    }
    
    const miniappEnabled = captchaConfig.miniappEnabled;
    const svgEnabled = captchaConfig.svgEnabled;
    const miniappCompleted = user.miniappVerified || false;
    const svgCompleted = user.svgCaptchaVerified || false;
    
    // Professional 2-Tier Completion Logic:
    
    // If both are enabled, both must be completed (strict sequential requirement)
    if (miniappEnabled && svgEnabled) {
      const allCompleted = miniappCompleted && svgCompleted;
      this.logger.info('Both captchas enabled - checking completion', { 
        userId, 
        miniappCompleted, 
        svgCompleted, 
        allCompleted 
      });
      return allCompleted;
    }
    
    // If only MiniApp is enabled
    if (miniappEnabled && !svgEnabled) {
      this.logger.info('Only MiniApp enabled - checking completion', { 
        userId, 
        miniappCompleted 
      });
      return miniappCompleted;
    }
    
    // If only SVG is enabled
    if (!miniappEnabled && svgEnabled) {
      this.logger.info('Only SVG enabled - checking completion', { 
        userId, 
        svgCompleted 
      });
      return svgCompleted;
    }
    
    // If no captcha is enabled (direct bot access)
    this.logger.info('No captchas enabled - allowing access', { userId });
    return true;
  }

  async promptForCaptcha(ctx: Context, type: 'registration' | 'verification'): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      this.logger.error('promptForCaptcha called without userId');
      await ctx.reply('❌ Unable to identify user');
      return;
    }
    
    // Extract and store referral code if it's a new user registration
    if (type === 'registration') {
      const referralCode = referralManager.extractReferralCode(ctx);
      if (referralCode) {
        await referralManager.storeReferralSession(userId, referralCode, 'captcha');
        this.logger.info('Stored referral code for captcha user', { userId, referralCode });
      }
    }

    const nextCaptcha = await this.getNextCaptchaType(userId);
    const captchaConfig = this.config.captcha;
    
    if (!nextCaptcha) {
      // All captchas completed, proceed to main bot with proper welcome flow
      this.logger.info('All captchas completed, proceeding to main bot', { userId, type });
      const user = await this.storage.getUser(userId);
      const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
      
      // Check if this is new user registration or existing user verification
      const isNewUser = !user || user.registrationStatus !== 'completed';
      
      if (isNewUser) {
        if (!user) {
          // Brand new user - create and welcome
          this.logger.info('Creating new user after all captcha completion', { userId });
          await userRegistrationService.registerNewUser(ctx);
        } else {
          // User exists but registration not completed - complete it
          this.logger.info('Completing registration for user who completed all captchas', { userId });
          await userRegistrationService.completeUserRegistration(ctx, user);
        }
      } else {
        // Existing user just completing verification - welcome back
        this.logger.info('Existing user completed captcha verification', { userId });
        await ctx.reply(
          '🎉 **All Verifications Complete!**\n\n' +
          'You have successfully completed all required security verifications. Welcome back!',
          { parse_mode: 'Markdown' }
        );
        await userRegistrationService.welcomeBackUser(ctx, user);
      }
      
      // Show menu immediately - no delay
      await this.menuHandler.showMainMenu(ctx);
      return;
    }
    
    // Professional Sequential Flow: Show the appropriate captcha with step indication
    const bothEnabled = captchaConfig.miniappEnabled && captchaConfig.svgEnabled;
    
    if (nextCaptcha === 'miniapp') {
      this.logger.info('Showing MiniApp captcha', { 
        userId, 
        type, 
        step: bothEnabled ? '1/2' : '1/1' 
      });
      await this.showMiniappCaptcha(ctx, type, bothEnabled);
    } else if (nextCaptcha === 'svg') {
      const user = await this.storage.getUser(userId);
      const isStep2 = bothEnabled && user?.miniappVerified;
      this.logger.info('Showing SVG captcha', { 
        userId, 
        type, 
        step: isStep2 ? '2/2' : '1/1' 
      });
      await this.showSvgCaptchaPrompt(ctx, type, isStep2);
    }
  }

  async showMiniappCaptcha(ctx: Context, type: 'registration' | 'verification', bothEnabled: boolean = false): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      this.logger.error('showMiniappCaptcha called without userId');
      return;
    }
    
    // Professional messaging with step indication
    let message = '🔒 **Security Verification Required**\n\n';
    
    // Add step indication if both captchas are enabled
    if (bothEnabled) {
      message += '📋 **Step 1 of 2: Interactive Verification**\n\n';
    }
    
    if (type === 'registration') {
      message += `Welcome to ${this.config.bot.name}! To ensure the security of our community, ` +
                `new users must complete a verification process.\n\n`;
    } else {
      message += `For security reasons and to maintain the integrity of our airdrop, ` +
                `please complete the verification process.\n\n`;
    }
    
    message += `🖥️ **Interactive Verification**\n` +
               `Complete the security challenge in our interactive interface.\n\n` +
               `✨ **Features:**\n` +
               `• Multiple challenge types\n` +
               `• Advanced security checks\n` +
               `• User-friendly interface\n` +
               `• Real-time validation\n\n`;
    
    if (bothEnabled) {
      message += `⏭️ **After this step:** You'll complete a text verification challenge.\n\n`;
    }
    
    message += `Click the button below to start:`;
    
    const sentMessage = await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          {
            text: bothEnabled ? 'Start Step 1: Interactive Verification' : 'Complete Interactive Verification',
            web_app: {
              url: await this.generateMiniappCaptchaUrl(userId)
            }
          }
        ]]
      }
    });
    
    // Store the message ID for auto-deletion
    const ctxWithSession = ctx as any;
    if (ctxWithSession.session) {
      ctxWithSession.session.verificationMessageId = sentMessage.message_id;
    }
    
    // Also store in user data for access from API if user exists
    const existingUser = await this.storage.getUser(userId);
    if (existingUser) {
      await this.storage.updateUser(userId, {
        'sessionData.verificationMessageId': sentMessage.message_id
      });
    }
    
    this.logger.info('MiniApp captcha prompt sent', {
      userId,
      type,
      step: bothEnabled ? '1/2' : '1/1',
      messageId: sentMessage.message_id
    });
  }

  async showSvgCaptchaPrompt(ctx: Context, type: 'registration' | 'verification', isStep2: boolean = false): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      this.logger.error('showSvgCaptchaPrompt called without userId');
      return;
    }

    const user = await this.storage.getUser(userId);
    
    let message = '🔤 **Text Verification Required**\n\n';
    
    // Professional step indication
    if (isStep2) {
      message += '📋 **Step 2 of 2: Text Verification**\n\n';
      message += `✅ Interactive verification completed successfully!\n` +
                `Now, please complete the text verification to finish the security process.\n\n`;
    } else {
      if (type === 'registration') {
        message += `Welcome to ${this.config.bot.name}! Please complete the text verification to continue.\n\n`;
      } else {
        message += `Please complete the text verification to access the bot features.\n\n`;
      }
    }
    
    message += `💡 **Instructions:**\n` +
               `• You'll receive an image with text\n` +
               `• Type the characters you see\n` +
               `• Case doesn't matter\n` +
               `• NO SKIP OPTION - Verification is required\n\n`;
    
    message += `Click the button below to start:`;
    
    const buttonText = isStep2 ? 
      'Start Step 2: Text Verification' : 
      'Start Text Verification';
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          {
            text: buttonText,
            callback_data: `captcha_svg_${userId}`
          }
        ]]
      }
    });
    
    this.logger.info('SVG captcha prompt sent', {
      userId,
      type,
      step: isStep2 ? '2/2' : '1/1',
      isSequentialStep2: isStep2
    });
  }

  async handleCaptchaCallback(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? (ctx.callbackQuery as any).data : undefined;
    if (!data) return;

    if (data === 'start_captcha') {
      await this.captchaService.startCaptchaChallenge(ctx);
    } else if (data.startsWith('captcha_')) {
      const parts = data.split('_');
      if (parts[1] === 'svg' && parts[2]) {
        // Direct SVG captcha - no intermediate messages
        this.logger.info('Starting SVG captcha directly from button click', { userId: parts[2] });
        await this.startActualSvgCaptcha(ctx, parts[2]);
      }
    }
  }

  async handleSvgCaptchaAnswer(ctx: Context, answer: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        await ctx.reply('❌ Unable to identify user');
        return;
      }

      const session_ctx = ctx as any;
      const captchaSession = session_ctx.session?.captchaSession;
      
      if (!captchaSession || !captchaSession.awaitingAnswer) {
        await ctx.reply('❌ No active captcha session found. Please start a new verification.');
        return;
      }

      const timeTaken = Date.now() - captchaSession.startTime;
      
      // Verify the captcha answer
      const result = await this.captchaService.verifyCaptcha(
        captchaSession.sessionId,
        answer,
        {
          ip: 'telegram',
          userAgent: 'TelegramBot',
          platform: 'telegram',
          userId: userId
        },
        timeTaken
      );
      
      if (result.success) {
        // Clear the session from context AND storage
        session_ctx.session.captchaSession = null;
        
        // Update user verification status
        let user = await this.storage.getUser(userId);
      if (!user) {
        // Create a new user with basic info if they don't exist yet (new user registration flow)
        this.logger.info('Creating new user during SVG captcha verification', { userId });
        
        // Get stored referral session
        const referralSession = await referralManager.getReferralSession(userId);
        let referredBy: string | null = null;
        
        if (referralSession?.referrerId) {
          referredBy = referralSession.referrerId;
          this.logger.info('Found referral session for captcha user', { 
            userId, 
            referralCode: referralSession.referralCode,
            referrerId: referredBy 
          });
        }
        
        const newUser = UserFactory.createCaptchaUser({
          telegramId: userId,
          firstName: ctx.from?.first_name,
          username: ctx.from?.username,
          languageCode: ctx.from?.language_code || 'en',
          referredBy
        });
        const created = await this.storage.createUser(newUser);
        if (created) {
          user = newUser;
        } else {
          this.logger.error('Failed to create user during SVG captcha verification', { userId });
          await ctx.reply('❌ Registration failed. Please try again.');
          return;
        }
      }
        
        if (user) {
          user.svgCaptchaVerified = true;
          user.lastCaptchaAt = new Date().toISOString();
          // Clear the active captcha session from storage
          user.activeCaptchaSession = null;
          await this.storage.saveUser(userId, user);
          this.logger.info('SVG captcha verification completed and saved, session cleared', { userId });
        }
        
        const captchaConfig = this.config.captcha;
        const bothEnabled = captchaConfig.miniappEnabled && captchaConfig.svgEnabled;
        const wasStep2 = bothEnabled && user?.miniappVerified;
        
        // Check if user has completed all required captchas
        const allCompleted = await this.hasCompletedAllCaptchas(userId);
        if (allCompleted) {
          // All captchas completed - send final welcome message only
          this.logger.info('All captchas completed - sending welcome message only', { userId });
          
          // Check if this is a new user or existing user
          const isNewUser = user && user.registrationStatus !== 'completed';
          
          // Complete user registration status and clear captcha session
          if (user) {
            user.registrationStatus = 'completed';
            user.lastActiveAt = new Date().toISOString();
            user.activeCaptchaSession = null; // Clear captcha session
            await this.storage.saveUser(userId, user);
          }
          
          // Process referral bonus if user was referred
          if (user && user.referredBy) {
            this.logger.info('Processing referral bonus after captcha completion', {
              newUserId: userId,
              referrerId: user.referredBy
            });
            await referralManager.processReferralBonus(user.referredBy, userId);
            
            // Clear referral session after processing
            await referralManager.clearReferralSession(userId);
          }
          
          // Send welcome message directly - no intermediate completion messages
          try {
            const { WelcomeHandler } = require('../../bot/handlers/welcome-handler');
            const welcomeHandler = new WelcomeHandler();
            await welcomeHandler.sendNewUserWelcome(ctx, user);
          } catch (error) {
            this.logger.error('Error using WelcomeHandler after all captcha completion:', error);
            // Fallback to simple completion message
            await ctx.reply(
              '🎉 **Registration Completed Successfully!**\n\n' +
              `Welcome to ${this.config.bot.name}, ${user?.firstName || 'User'}!\n\n` +
              'Your security verification and registration are now complete.',
              { parse_mode: 'Markdown' }
            );
          }
        } else {
          // Not all captchas completed yet - continue flow directly without intermediate messages
          this.logger.info('SVG captcha completed, continuing to next step', { userId });
          await this.promptForCaptcha(ctx, 'verification');
        }
      } else {
        const attemptsLeft = captchaSession.maxAttempts - result.attempts;
        if (attemptsLeft > 0) {
          // Update attempt count in storage
          const user = await this.storage.getUser(userId);
          if (user?.activeCaptchaSession) {
            user.activeCaptchaSession.attempts = result.attempts;
            await this.storage.saveUser(userId, user);
          }
          
          await ctx.reply(
            `❌ **Incorrect Answer**\n\n` +
            `Please try again. You have ${attemptsLeft} attempt(s) remaining.\n\n` +
            `💡 Make sure to type exactly what you see in the image.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          // Clear the session from context AND storage when max attempts exceeded
          session_ctx.session.captchaSession = null;
          
          // Also clear from user storage
          const user = await this.storage.getUser(userId);
          if (user) {
            user.activeCaptchaSession = null;
            await this.storage.saveUser(userId, user);
          }
          
          await ctx.reply(
            '❌ **Maximum Attempts Exceeded**\n\n' +
            'Please start a new verification challenge.',
            { parse_mode: 'Markdown' }
          );
          await this.promptForCaptcha(ctx, 'verification');
        }
      }
    } catch (error) {
      this.logger.error('SVG captcha answer verification error:', error);
      await ctx.reply('❌ Failed to verify captcha. Please try again.');
    }
  }

  async handleCaptchaCompletion(ctx: Context, data: any): Promise<void> {
    await this.captchaService.processCaptchaCompletion(ctx, data);
  }
  
  /**
   * Handle miniapp captcha completion - Direct Flow (No Intermediate Messages/Delays)
   */
  async handleMiniappCompletion(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        this.logger.error('handleMiniappCompletion called without userId');
        await ctx.reply('❌ Unable to identify user');
        return;
      }

      // Update user miniapp verification status
      let user = await this.storage.getUser(userId);
      if (user) {
        user.miniappVerified = true;
        user.lastCaptchaAt = new Date().toISOString();
        await this.storage.saveUser(userId, user);
        this.logger.info('MiniApp verification completed and saved', { userId });
      }
      
      const captchaConfig = this.config.captcha;
      const bothEnabled = captchaConfig.miniappEnabled && captchaConfig.svgEnabled;
      
      // Check what comes next
      const nextCaptcha = await this.getNextCaptchaType(userId);
      
      if (nextCaptcha === 'svg') {
        // Direct SVG captcha - no intermediate messages or delays
        this.logger.info('Directly starting SVG captcha after miniapp completion', { userId });
        await this.startActualSvgCaptcha(ctx, userId);
      } else {
        // All captchas completed - proceed to main bot with proper welcome flow
        const allCompleted = await this.hasCompletedAllCaptchas(userId);
        if (allCompleted) {
          this.logger.info('All captchas completed, proceeding to welcome handler', { userId });
          const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
          
          // Check if this is a new user registration flow
          const isNewUser = !user;
          
          if (isNewUser) {
            // For new users: complete full registration with welcome message
            this.logger.info('New user completing registration after miniapp captcha', { userId });
            
            // Get stored referral session
            const referralSession = await referralManager.getReferralSession(userId);
            let referredBy: string | null = null;
            
            if (referralSession?.referrerId) {
              referredBy = referralSession.referrerId;
              this.logger.info('Found referral session for miniapp captcha user', { 
                userId, 
                referralCode: referralSession.referralCode,
                referrerId: referredBy 
              });
            }
            
            // Create user first
            const newUser = UserFactory.createCaptchaUser({
              telegramId: userId,
              firstName: ctx.from?.first_name,
              username: ctx.from?.username,
              languageCode: ctx.from?.language_code || 'en',
              referredBy
            });
            const created = await this.storage.createUser(newUser);
            if (created) {
              user = newUser;
              user.miniappVerified = true;
              user.registrationStatus = 'completed';
              user.lastCaptchaAt = new Date().toISOString();
              await this.storage.saveUser(userId, user);
              
              // Process referral bonus if user was referred
              if (user.referredBy) {
                this.logger.info('Processing referral bonus after miniapp captcha completion', {
                  newUserId: userId,
                  referrerId: user.referredBy
                });
                await referralManager.processReferralBonus(user.referredBy, userId);
                
                // Clear referral session after processing
                await referralManager.clearReferralSession(userId);
              }
              
              // Use proper welcome handler instead of registerNewUser
              const welcomeHandler = new (await import('../../bot/handlers/welcome-handler')).WelcomeHandler();
              await welcomeHandler.sendNewUserWelcome(ctx, user);
            }
          } else {
            // For existing users: use proper welcome handler
            user.registrationStatus = 'completed';
            user.lastActiveAt = new Date().toISOString();
            await this.storage.saveUser(userId, user);
            
            const welcomeHandler = new (await import('../../bot/handlers/welcome-handler')).WelcomeHandler();
            await welcomeHandler.sendNewUserWelcome(ctx, user);
          }
        }
      }
      
    } catch (error) {
      this.logger.error('Error handling miniapp completion:', error);
      await ctx.reply('❌ Failed to process verification completion. Please try again.');
    }
  }

  async generateMiniappCaptchaUrl(userId: string): Promise<string> {
    return this.captchaService.generateMiniappCaptchaUrl(userId);
  }

  /**
   * Start actual SVG captcha with image generation (Public method for external calls)
   */
  public async startActualSvgCaptcha(ctx: Context, sessionIdFromCallback: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        await ctx.reply('❌ Unable to identify user');
        return;
      }

      // Create SVG captcha session
      const session = await this.captchaService.createSession(userId, 'svg', {
        ip: 'telegram',
        userAgent: 'TelegramBot',
        platform: 'telegram',
        userId: userId
      });
      
      if (session && session.challenge && session.answer) {
        // Generate→Send→Forget pattern: Generate image buffer and send immediately
        const imageBuffer = await this.captchaService.generateCaptchaImageBuffer(session.answer);
        
        // Send the image directly with simple caption
        await ctx.replyWithPhoto(
          { source: imageBuffer },
          {
            caption: `❇️ Please enter the captcha:`,
            parse_mode: 'Markdown'
          }
        );
        
        // Store session info in user context AND storage for persistence
        const session_ctx = ctx as any;
        session_ctx.session = session_ctx.session || {};
        session_ctx.session.captchaSession = {
          sessionId: session.id,
          type: 'svg',
          awaitingAnswer: true,
          startTime: Date.now()
        };
        
        // IMPORTANT: Also store in database for cross-context persistence
        const user = await this.storage.getUser(userId);
        if (user) {
          user.activeCaptchaSession = {
            sessionId: session.id,
            type: 'svg',
            awaitingAnswer: true,
            startTime: Date.now(),
            expiresAt: session.expiresAt,
            maxAttempts: session.maxAttempts,
            attempts: 0
          };
          await this.storage.saveUser(userId, user);
          this.logger.info('SVG captcha session stored in database for persistence', { userId, sessionId: session.id });
        }
        
        this.logger.info('SVG Captcha challenge sent with image', {
          userId,
          sessionId: session.id,
          difficulty: session.challenge.difficulty,
          pattern: 'generate→send→forget'
        });
      } else {
        await ctx.reply('❌ Failed to generate captcha challenge. Please try again.');
      }
    } catch (error) {
      this.logger.error('SVG captcha start error:', error);
      await ctx.reply(
        '❌ **Captcha Error**\n\n' +
        'Failed to start verification challenge. Please try again or use the interactive verification option.',
        { parse_mode: 'Markdown' }
      );
    }
  }
}