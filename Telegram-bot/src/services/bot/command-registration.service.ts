/**
 * Command Registration Service
 * Handles registration and management of bot commands
 * Extracted from monolithic TelegramBot class
 */

import { Context, Telegraf } from 'telegraf';
import { BotCommand } from 'telegraf/typings/core/types/typegram';
import { BaseService, ServiceIdentifiers } from '../../core/container';
import { ICommandRegistrationService, ILogger, IAdminAuthService } from '../../core/interfaces';
import { IUserRegistrationService } from '../../interfaces/bot-services.interface';
import { MenuHandler } from '../../bot/handlers/menu-handler';
import { TaskHandler } from '../../bot/handlers/task-handler';
import { WalletHandler } from '../../bot/handlers/wallet-handler';
import { ReferralHandler } from '../../bot/handlers/referral-handler';
import { PointsHandler } from '../../bot/handlers/points-handler';

export interface CommandHandler {
  (ctx: Context): Promise<void>;
}

export interface CommandDefinition {
  command: string;
  description: string;
  handler: CommandHandler;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  enabled?: boolean;
}

export class CommandRegistrationService extends BaseService implements ICommandRegistrationService {
  private readonly logger: ILogger;
  private readonly adminAuth: IAdminAuthService;
  private readonly commands: Map<string, CommandDefinition> = new Map();
  private bot: Telegraf | null = null;

  constructor() {
    super();
    this.logger = this.resolve<ILogger>(ServiceIdentifiers.Logger);
    this.adminAuth = this.resolve<IAdminAuthService>(ServiceIdentifiers.AdminAuth);
  }

  /**
   * Register all commands with the bot
   */
  public async registerCommands(bot: Telegraf): Promise<void> {
    this.bot = bot;
    
    try {
      this.logger.info('Registering bot commands...');
      
      // Register standard user commands
      this.registerUserCommands();
      
      // Register admin commands
      this.registerAdminCommands();
      
      // Apply command handlers to bot
      await this.applyCommandHandlers();
      
      // Update Telegram bot commands UI
      await this.updateTelegramCommands();
      
      this.logger.info(`Successfully registered ${this.commands.size} commands`);
      
    } catch (error) {
      this.logger.error('Failed to register commands:', error);
      throw new Error(`Command registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Register bot commands with Telegram (for UI)
   */
  public async registerBotCommands(commands: BotCommand[]): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot instance required for command registration');
    }

    try {
      await this.bot.telegram.setMyCommands(commands);
      this.logger.info(`Updated Telegram with ${commands.length} commands`);
      
    } catch (error) {
      this.logger.error('Failed to update Telegram commands:', error);
      throw error;
    }
  }

  /**
   * Get available commands for a user
   */
  public async getAvailableCommands(userId?: string): Promise<BotCommand[]> {
    const availableCommands: BotCommand[] = [];
    
    try {
      for (const [commandName, commandDef] of this.commands.entries()) {
        if (!commandDef.enabled) continue;
        
        // Check admin permissions if required
        if (commandDef.adminOnly || commandDef.superAdminOnly) {
          if (!userId) continue;
          
          const isAdmin = await this.adminAuth.isAdmin(userId);
          if (!isAdmin) continue;
          
          if (commandDef.superAdminOnly) {
            const isSuperAdmin = await this.adminAuth.isSuperAdmin(userId);
            if (!isSuperAdmin) continue;
          }
        }
        
        availableCommands.push({
          command: commandName,
          description: commandDef.description
        });
      }
      
      return availableCommands;
      
    } catch (error) {
      this.logger.error('Failed to get available commands:', error);
      return [];
    }
  }

  /**
   * Add a new command dynamically
   */
  public addCommand(commandDef: CommandDefinition): void {
    this.commands.set(commandDef.command, commandDef);
    this.logger.debug(`Added command: ${commandDef.command}`);
  }

  /**
   * Remove a command
   */
  public removeCommand(command: string): void {
    this.commands.delete(command);
    this.logger.debug(`Removed command: ${command}`);
  }

  /**
   * Enable/disable a command
   */
  public setCommandEnabled(command: string, enabled: boolean): void {
    const commandDef = this.commands.get(command);
    if (commandDef) {
      commandDef.enabled = enabled;
      this.logger.debug(`Command ${command} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Get command statistics
   */
  public getCommandStats(): {
    total: number;
    enabled: number;
    adminOnly: number;
    superAdminOnly: number;
  } {
    let enabled = 0;
    let adminOnly = 0;
    let superAdminOnly = 0;
    
    for (const commandDef of this.commands.values()) {
      if (commandDef.enabled) enabled++;
      if (commandDef.adminOnly) adminOnly++;
      if (commandDef.superAdminOnly) superAdminOnly++;
    }
    
    return {
      total: this.commands.size,
      enabled,
      adminOnly,
      superAdminOnly
    };
  }

  // Private helper methods

  private registerUserCommands(): void {
    const userCommands: CommandDefinition[] = [
      {
        command: 'start',
        description: 'Start the bot',
        handler: this.handleStartCommand.bind(this),
        enabled: true
      },
      {
        command: 'menu',
        description: 'Show main menu',
        handler: this.handleMenuCommand.bind(this),
        enabled: true
      },
      {
        command: 'points',
        description: 'View your points',
        handler: this.handlePointsCommand.bind(this),
        enabled: true
      },
      {
        command: 'tasks',
        description: 'View available tasks',
        handler: this.handleTasksCommand.bind(this),
        enabled: true
      },
      {
        command: 'wallet',
        description: 'Manage your wallet',
        handler: this.handleWalletCommand.bind(this),
        enabled: true
      },
      {
        command: 'referrals',
        description: 'View referral information',
        handler: this.handleReferralsCommand.bind(this),
        enabled: true
      },
      {
        command: 'help',
        description: 'Get help and support',
        handler: this.handleHelpCommand.bind(this),
        enabled: true
      }
    ];

    for (const command of userCommands) {
      this.commands.set(command.command, command);
    }
  }

  private registerAdminCommands(): void {
    const adminCommands: CommandDefinition[] = [
      {
        command: 'admin',
        description: 'Access admin panel',
        handler: this.handleAdminCommand.bind(this),
        adminOnly: true,
        enabled: true
      },
      {
        command: 'stats',
        description: 'View system statistics',
        handler: this.handleStatsCommand.bind(this),
        adminOnly: true,
        enabled: true
      },
      {
        command: 'broadcast',
        description: 'Send broadcast message',
        handler: this.handleBroadcastCommand.bind(this),
        adminOnly: true,
        enabled: true
      },
      {
        command: 'maintenance',
        description: 'Toggle maintenance mode',
        handler: this.handleMaintenanceCommand.bind(this),
        superAdminOnly: true,
        enabled: true
      },
      {
        command: 'logs',
        description: 'View system logs',
        handler: this.handleLogsCommand.bind(this),
        superAdminOnly: true,
        enabled: true
      },
      {
        command: 'backup',
        description: 'Create system backup',
        handler: this.handleBackupCommand.bind(this),
        superAdminOnly: true,
        enabled: true
      }
    ];

    for (const command of adminCommands) {
      this.commands.set(command.command, command);
    }
  }

  private async applyCommandHandlers(): Promise<void> {
    if (!this.bot) return;

    for (const [commandName, commandDef] of this.commands.entries()) {
      if (!commandDef.enabled) continue;

      // Create middleware for permission checking
      const handler = this.createCommandHandler(commandDef);
      
      // Register with bot
      this.bot.command(commandName, handler);
    }
  }

  private createCommandHandler(commandDef: CommandDefinition): CommandHandler {
    return async (ctx: Context) => {
      try {
        const userId = ctx.from?.id?.toString();
        
        // Check admin permissions if required
        if (commandDef.adminOnly || commandDef.superAdminOnly) {
          if (!userId) {
            await ctx.reply('❌ Authentication required for this command.');
            return;
          }
          
          const isAdmin = await this.adminAuth.isAdmin(userId);
          if (!isAdmin) {
            await ctx.reply('❌ Admin access required for this command.');
            return;
          }
          
          if (commandDef.superAdminOnly) {
            const isSuperAdmin = await this.adminAuth.isSuperAdmin(userId);
            if (!isSuperAdmin) {
              await ctx.reply('❌ Super admin access required for this command.');
              return;
            }
          }
        }
        
        // Execute command handler
        await commandDef.handler(ctx);
        
      } catch (error) {
        this.logger.error(`Command handler error for /${commandDef.command}:`, error);
        await ctx.reply('❌ An error occurred while processing your command. Please try again.');
      }
    };
  }

  private async updateTelegramCommands(): Promise<void> {
    try {
      const userCommands = await this.getAvailableCommands();
      await this.registerBotCommands(userCommands);
      
    } catch (error) {
      this.logger.error('Failed to update Telegram commands:', error);
    }
  }

  // Command handlers - delegate to appropriate services

  private async handleStartCommand(ctx: Context): Promise<void> {
    // Delegate to UserRegistrationService
    const userRegistration = this.resolve<IUserRegistrationService>(ServiceIdentifiers.UserRegistration);
    await userRegistration.registerNewUser(ctx);
  }

  private async handleMenuCommand(ctx: Context): Promise<void> {
    // Delegate to MenuHandler
    const menuHandler = this.resolve<MenuHandler>(ServiceIdentifiers.MenuHandler);
    await menuHandler.showMainMenu(ctx);
  }

  private async handlePointsCommand(ctx: Context): Promise<void> {
    // Delegate to PointsHandler
    const pointsHandler = this.resolve<PointsHandler>(ServiceIdentifiers.PointsHandler);
    await pointsHandler.showPoints(ctx);
  }

  private async handleTasksCommand(ctx: Context): Promise<void> {
    // Delegate to TaskHandler
    const taskHandler = this.resolve<TaskHandler>(ServiceIdentifiers.TaskHandler);
    await taskHandler.showTasks(ctx);
  }

  private async handleWalletCommand(ctx: Context): Promise<void> {
    // Delegate to WalletHandler
    const walletHandler = this.resolve<WalletHandler>(ServiceIdentifiers.WalletHandler);
    await walletHandler.showWallet(ctx);
  }

  private async handleReferralsCommand(ctx: Context): Promise<void> {
    // Delegate to ReferralHandler
    const referralHandler = this.resolve<ReferralHandler>(ServiceIdentifiers.ReferralHandler);
    await referralHandler.showReferrals(ctx);
  }

  private async handleHelpCommand(ctx: Context): Promise<void> {
    const helpText = `
🆘 **Help & Support**

**Available Commands:**
/menu - Show main menu
/points - View your points
/tasks - View available tasks  
/wallet - Manage your wallet
/referrals - View referral information

**Need more help?**
Contact our support team or check the FAQ in the main menu.

**Having issues?**
Try /start to reset your session.
    `.trim();

    await ctx.reply(helpText, { parse_mode: 'Markdown' });
  }

  private async handleAdminCommand(ctx: Context): Promise<void> {
    // Delegate to AdminHandler
    const adminHandler = this.resolve(ServiceIdentifiers.AdminHandler);
    // This will be replaced with AdminUIService later
    await ctx.reply('🔧 Admin panel access - redirecting to admin interface...');
  }

  private async handleStatsCommand(ctx: Context): Promise<void> {
    // Delegate to AdminStatsService
    const adminStats: any = this.resolve<any>(ServiceIdentifiers.AdminStats);
    const stats = await adminStats.getSystemStats();
    
    const statsText = `
📊 **System Statistics**

👥 **Users:** ${stats.users.total} total, ${stats.users.active} active
📋 **Tasks:** ${stats.tasks.total} total, ${stats.tasks.completed} completed
⚡ **Performance:** ${Math.round(stats.system.uptime / 3600)}h uptime
    `.trim();

    await ctx.reply(statsText, { parse_mode: 'Markdown' });
  }

  private async handleBroadcastCommand(ctx: Context): Promise<void> {
    await ctx.reply('📢 Broadcast functionality - use admin panel for detailed broadcast management.');
  }

  private async handleMaintenanceCommand(ctx: Context): Promise<void> {
    await ctx.reply('🔧 Maintenance mode controls - contact system administrator.');
  }

  private async handleLogsCommand(ctx: Context): Promise<void> {
    // Delegate to SystemAdminService
    const systemAdmin: any = this.resolve<any>(ServiceIdentifiers.SystemAdmin);
    const logs: any[] = await systemAdmin.getSystemLogs('error', 10);
    
    const logText = logs.length > 0 
      ? `📋 **Recent Errors (${logs.length}):**\n\n${(logs as any[]).map((log: any) => `• ${log.timestamp}: ${log.message}`).join('\n')}`
      : '✅ No recent errors found.';
    
    await ctx.reply(logText, { parse_mode: 'Markdown' });
  }

  private async handleBackupCommand(ctx: Context): Promise<void> {
    try {
      await ctx.reply('🔄 Creating system backup...');
      
      // Delegate to SystemAdminService
    const systemAdmin: any = this.resolve<any>(ServiceIdentifiers.SystemAdmin);
    const backup = await systemAdmin.performBackup();
      
      if (backup.success) {
        await ctx.reply(`✅ Backup created successfully!\nBackup ID: ${backup.backupId}\nSize: ${(backup.size / 1024 / 1024).toFixed(2)} MB`);
      } else {
        await ctx.reply('❌ Backup creation failed. Check system logs for details.');
      }
      
    } catch (error) {
      this.logger.error('Backup command error:', error);
      await ctx.reply('❌ Backup creation failed due to system error.');
    }
  }

  /**
   * Dispose of resources
   */
  public async dispose(): Promise<void> {
    this.commands.clear();
    this.bot = null;
  }
}