import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../../services/logger';
import { StorageManager } from '../../storage';
import { getConfig } from '../../config';
import { MenuHandler } from './menu-handler';
import { CallbackQueryService, MessageService } from '../../shared';
import { WelcomeConfigService } from '../../config/welcome-config';

export class WelcomeHandler {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly config = getConfig();
  private readonly welcomeConfig = WelcomeConfigService.getInstance();
  private readonly menuHandler = new MenuHandler();

  /**
   * Send comprehensive welcome message for new users
   */
  async sendNewUserWelcome(ctx: Context, user: any): Promise<void> {
    try {
      const wConfig = this.welcomeConfig.getWelcomeConfig();
      
      // Always fetch fresh user data to ensure we have the latest referral code
      const freshUser = await this.storage.getUser(user.telegramId) || user;
      
      if (!wConfig.enabled || !wConfig.useEnhancedWelcome) {
        await this.sendBasicWelcome(ctx, freshUser);
        return;
      }

      // Direct onboarding without delay
      const onboardingText = this.getOnboardingText(freshUser);
      const keyboard = this.getNewUserWelcomeKeyboard();

      await ctx.reply(onboardingText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });

      this.logger.info('Professional welcome sequence initiated', {
        userId: freshUser.telegramId,
        username: freshUser.username,
        firstName: freshUser.firstName,
        useEnhancedWelcome: true
      });

    } catch (error) {
      this.logger.error('Error sending new user welcome:', error);
      // Fallback to basic welcome
      await this.sendBasicWelcome(ctx, user);
    }
  }


  /**
   * Show getting started guide
   */
  async showGettingStarted(ctx: Context): Promise<void> {
    try {
      const user = await this.validateUser(ctx);
      if (!user) return;

      const guideText = this.getGettingStartedText(user);
      const keyboard = this.getGettingStartedKeyboard();

      await MessageService.editOrReply(ctx, guideText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });

    } catch (error) {
      this.logger.error('Error showing getting started guide:', error);
      await ctx.reply('❌ Error loading guide. Please try again.');
    }
  }

  /**
   * Show how to earn points
   */
  async showHowToEarn(ctx: Context): Promise<void> {
    try {
      const user = await this.validateUser(ctx);
      if (!user) return;

      // Always fetch fresh user data to ensure we have the latest referral code
      const freshUser = await this.storage.getUser(user.telegramId) || user;
      
      const earnText = this.getHowToEarnText(freshUser);
      const keyboard = this.getHowToEarnKeyboard();

      await MessageService.editOrReply(ctx, earnText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });

    } catch (error) {
      this.logger.error('Error showing how to earn guide:', error);
      await ctx.reply('❌ Error loading guide. Please try again.');
    }
  }

  /**
   * Show bot features overview
   */
  async showBotFeatures(ctx: Context): Promise<void> {
    try {
      const user = await this.validateUser(ctx);
      if (!user) return;

      const featuresText = this.getBotFeaturesText(user);
      const keyboard = this.getBotFeaturesKeyboard();

      await MessageService.editOrReply(ctx, featuresText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });

    } catch (error) {
      this.logger.error('Error showing bot features:', error);
      await ctx.reply('❌ Error loading features. Please try again.');
    }
  }

  /**
   * Handle welcome callback queries
   */
  async handleCallback(ctx: Context): Promise<void> {
    const data = CallbackQueryService.getCallbackData(ctx);
    if (!data) return;

    switch (data) {
      case 'welcome_getting_started':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.showGettingStarted(ctx);
        }, true);
        break;
      case 'welcome_how_to_earn':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.showHowToEarn(ctx);
        }, true);
        break;
      case 'welcome_bot_features':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.showBotFeatures(ctx);
        }, true);
        break;
      case 'welcome_start_earning':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.menuHandler.showMainMenu(ctx);
        }, true);
        break;
      case 'welcome_back':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.sendNewUserWelcome(ctx, await this.validateUser(ctx));
        }, true);
        break;
      default:
        this.logger.warn('Unknown welcome callback:', data);
    }
  }

  private getOnboardingText(user: any): string {
    return `
<b>🎯 Let's Get You Started</b>

<b>${user.firstName}</b>, here's how you can maximize your experience:

Our platform offers multiple ways to earn rewards through task completion, community participation, and referrals. The interactive guide below will help you understand all available opportunities.

<b>💡 Pro Tip:</b> Complete daily tasks and invite friends to maximize your rewards! Active users earn significantly more points.

Choose your next step:
    `.trim();
  }

  private getNewUserWelcomeText(user: any): string {
    return `
🚀 <b>Welcome to ${this.config.bot.name}</b>

👋 Hello <b>${user.firstName}</b>! Your airdrop journey has begun!

<b>📋 Account Details:</b>
💰 Starting Points: <b>${user.points || 0}</b>
🎫 Your Referral Code: <code>${user.referralCode || 'Generating...'}</code>
📅 Joined: <b>${new Date().toLocaleDateString()}</b>

<b>🚀 What to do now?</b>
Our bot has many features that you can use to earn points. Check out the buttons below to start your journey!

<b>💡 Pro Tip:</b> Complete tasks and refer friends to maximize your earning potential!
    `.trim();
  }

  private getNewUserWelcomeKeyboard(): InlineKeyboardMarkup {
    const wConfig = this.welcomeConfig.getWelcomeConfig();
    const buttons: any[] = [];
    
    if (wConfig.showGettingStarted) {
      buttons.push([{
        text: 'Quick Start Guide',
        callback_data: 'welcome_getting_started'
      }]);
    }
    
    if (wConfig.showHowToEarn) {
      buttons.push([{
        text: 'How to Earn Points',
        callback_data: 'welcome_how_to_earn'
      }]);
    }
    
    if (wConfig.showBotFeatures) {
      buttons.push([{
        text: 'Bot Features',
        callback_data: 'welcome_bot_features'
      }]);
    }
    
    // Always show the main action button
    buttons.push([{
      text: 'Start Earning Now',
      callback_data: 'welcome_start_earning'
    }]);
    
    return { inline_keyboard: buttons };
  }

  private getGettingStartedText(user: any): string {
    return `
🎯 <b>Getting Started Guide</b>

👋 Hi <b>${user.firstName}</b>! Here's your step-by-step guide:

<b>📋 Step 1: Explore the Menu</b>
• Access main menu using the /menu command
• Explore each section to understand available features

<b>📝 Step 2: Complete Your First Task</b>
• Go to the Tasks section
• Start with easy tasks
• Social media tasks are the simplest

**👛 Step 3: Connect Your Wallet**
• Navigate to the Wallet section
• Connect your TON or EVM wallet
• Required for token withdrawals

<b>👥 Step 4: Invite Friends</b>
• Share your referral code with friends
• Earn bonus points for each successful referral
• Receive additional bonuses based on friends' earnings

<b>✅ Ready to start?</b>
    `.trim();
  }

  private getGettingStartedKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text: 'How to Earn Points',
            callback_data: 'welcome_how_to_earn'
          }
        ],
        [
          {
            text: 'Bot Features',
            callback_data: 'welcome_bot_features'
          }
        ],
        [
          {
            text: 'Start Earning Now!',
            callback_data: 'welcome_start_earning'
          }
        ],
        [
          {
            text: 'Back to Welcome',
            callback_data: 'welcome_back'
          }
        ]
      ]
    };
  }

  private getHowToEarnText(user: any): string {
    const taskReward = (this.config.points?.twitterFollow || this.config.points?.retweet || 10);
    const referralBonus = this.config.bot.referralBonus || 50;
    const dailyBonus = this.config.bot.dailyBonus || 5;
    // Captcha rewards removed per user request

    return `
💰 <b>How to Earn Points</b>

Hi <b>${user.firstName}</b>! Here are all the ways you can earn rewards:

<b>📝 Complete Tasks (+${taskReward}-100 Points)</b>
• Social media tasks (Follow, Like, Share)
• Community participation tasks
• Content creation tasks
• Daily check-in tasks

<b>👥 Refer Friends (+${referralBonus} Points)</b>
• Friend joins and you both receive bonuses
• Earn commission from friends' earnings

<b>🎯 Daily Activities (+${dailyBonus} Points)</b>
• Daily check-in rewards
• Regular platform interaction bonuses
• New feature exploration rewards

<b>🔒 Verification Requirements</b>
• Complete account verification process
• Pass security challenges



<b>💡 Current Balance: ${(user.points || 0).toLocaleString()} Points</b>
    `.trim();
  }

  private getHowToEarnKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text: 'Getting Started Guide',
            callback_data: 'welcome_getting_started'
          }
        ],
        [
          {
            text: 'Bot Features',
            callback_data: 'welcome_bot_features'
          }
        ],
        [
          {
            text: 'Start Earning Now!',
            callback_data: 'welcome_start_earning'
          }
        ],
        [
          {
            text: 'Back to Welcome',
            callback_data: 'welcome_back'
          }
        ]
      ]
    };
  }

  private getBotFeaturesText(user: any): string {
    return `
⚡ <b>Bot Features Overview</b>

Hi <b>${user.firstName}</b>! Discover our platform's powerful features:

<b>📝 Task Management System</b>
• Automated task verification
• Real-time point distribution
• Progress tracking
• Multiple task categories

<b>👛 Multi-Wallet Support</b>
• TON Wallet integration
• Ethereum wallet support
• WalletConnect v2 protocol
• Secure transaction handling

<b>👥 Advanced Referral System</b>
• Multi-level referral tracking
• Bonus point distribution
• Referral analytics
• Commission calculations

<b>🏆 Leaderboard & Competitions</b>
• Real-time rankings
• Weekly competitions
• Achievement system
• Reward distribution

<b>🔐 Security Features</b>
• Advanced anti-bot protection
• Multi-account detection
• Secure captcha system
• Real-time fraud detection

<b>📊 Analytics Dashboard</b>
• Detailed earnings stats
• Task completion history
• Referral performance
• Point transaction logs

<b>🎨 User Experience</b>
• Interactive inline keyboards
• Real-time notifications
• Multi-language support
• Mobile-optimized interface

Ready to explore these features?
    `.trim();
  }

  private getBotFeaturesKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text: 'Getting Started Guide',
            callback_data: 'welcome_getting_started'
          }
        ],
        [
          {
            text: 'How to Earn Points',
            callback_data: 'welcome_how_to_earn'
          }
        ],
        [
          {
            text: 'Start Earning Now!',
            callback_data: 'welcome_start_earning'
          }
        ],
        [
          {
            text: 'Back to Welcome',
            callback_data: 'welcome_back'
          }
        ]
      ]
    };
  }

  private async sendBasicWelcome(ctx: Context, user: any): Promise<void> {
    const basicText = 
      `🎉 Welcome to ${this.config.bot.name}!\n\n` +
      `Hello ${user.firstName}! You've successfully joined our airdrop program.\n\n` +
      `💰 Starting Points: ${user.points || 0}\n` +
      `🎫 Your Referral Code: ${user.referralCode || 'Generating...'}\n\n` +
      `Use /menu to explore all features!`;

    await ctx.reply(basicText, { link_preview_options: { is_disabled: true } });
  }

  private async validateUser(ctx: Context): Promise<any> {
    const userId = ctx.from?.id?.toString();
    if (!userId) return null;

    try {
      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found. Please use /start to register.');
        return null;
      }
      return user;
    } catch (error) {
      this.logger.error('Error validating user:', error);
      return null;
    }
  }
}