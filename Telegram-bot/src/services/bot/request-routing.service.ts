/**
 * Request Routing Service
 * Handles routing of incoming requests to appropriate handlers
 * Extracted from monolithic TelegramBot class
 */

import { Context } from 'telegraf';
import { BaseService, ServiceIdentifiers } from '../../core/container';
import { IRequestRoutingService, ILogger } from '../../core/interfaces';
import { MenuHandler } from '../../bot/handlers/menu-handler';
import { TaskHandler } from '../../bot/handlers/task-handler';
import { WalletHandler } from '../../bot/handlers/wallet-handler';
import { PointsHandler } from '../../bot/handlers/points-handler';
import { ReferralHandler } from '../../bot/handlers/referral-handler';

export interface RouteHandler {
  pattern: string | RegExp;
  handler: (ctx: Context, data?: any) => Promise<void>;
  priority?: number;
}

export interface CallbackRoute extends RouteHandler {
  type: 'callback';
}

export interface TextRoute extends RouteHandler {
  type: 'text';
}

export interface DocumentRoute extends RouteHandler {
  type: 'document';
  mimeTypes?: string[];
}

export interface WebAppRoute extends RouteHandler {
  type: 'webapp';
}

export class RequestRoutingService extends BaseService implements IRequestRoutingService {
  private readonly logger: ILogger;
  private readonly callbackRoutes: CallbackRoute[] = [];
  private readonly textRoutes: TextRoute[] = [];
  private readonly documentRoutes: DocumentRoute[] = [];
  private readonly webAppRoutes: WebAppRoute[] = [];

  constructor() {
    super();
    this.logger = this.resolve<ILogger>(ServiceIdentifiers.Logger);
    this.initializeRoutes();
  }

  /**
   * Route callback queries to appropriate handlers
   */
  public async routeCallback(ctx: Context, callbackData: string): Promise<void> {
    try {
      this.logger.debug(`Routing callback: ${callbackData}`);
      
      // Find matching route
      const route = this.findMatchingRoute(this.callbackRoutes, callbackData);
      
      if (route) {
        // Extract data from callback if pattern includes groups
        const data = this.extractRouteData(route.pattern, callbackData);
        await route.handler(ctx, data);
      } else {
        await this.handleUnknownCallback(ctx, callbackData);
      }
      
    } catch (error) {
      this.logger.error('Callback routing error:', error);
      await this.handleRoutingError(ctx, error, 'callback');
    }
  }

  /**
   * Route text messages to appropriate handlers
   */
  public async routeTextMessage(ctx: Context): Promise<void> {
    try {
      const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      
      if (!text) {
        return;
      }
      
      this.logger.debug(`Routing text message: ${text.substring(0, 50)}...`);
      
      // Find matching route
      const route = this.findMatchingRoute(this.textRoutes, text);
      
      if (route) {
        const data = this.extractRouteData(route.pattern, text);
        await route.handler(ctx, data);
      } else {
        await this.handleUnknownText(ctx, text);
      }
      
    } catch (error) {
      this.logger.error('Text routing error:', error);
      await this.handleRoutingError(ctx, error, 'text');
    }
  }

  /**
   * Route document uploads to appropriate handlers
   */
  public async routeDocument(ctx: Context): Promise<void> {
    try {
      const document = ctx.message && 'document' in ctx.message ? ctx.message.document : null;
      
      if (!document) {
        return;
      }
      
      this.logger.debug(`Routing document: ${document.file_name}, MIME: ${document.mime_type}`);
      
      // Find matching route based on MIME type or filename
      const route = this.findMatchingDocumentRoute(document);
      
      if (route) {
        await route.handler(ctx, { document });
      } else {
        await this.handleUnknownDocument(ctx, document);
      }
      
    } catch (error) {
      this.logger.error('Document routing error:', error);
      await this.handleRoutingError(ctx, error, 'document');
    }
  }

  /**
   * Route web app data to appropriate handlers
   */
  public async routeWebAppData(ctx: Context): Promise<void> {
    try {
      const webAppData = ctx.message && 'web_app_data' in ctx.message ? ctx.message.web_app_data : null;
      
      if (!webAppData) {
        return;
      }
      
      this.logger.debug('Routing web app data');
      
      // Parse web app data
      let parsedData;
      try {
        parsedData = JSON.parse(webAppData.data);
      } catch (parseError) {
        this.logger.error('Invalid web app data format:', parseError);
        await ctx.reply('❌ Invalid data format received.');
        return;
      }
      
      // Find matching route
      const route = this.findMatchingRoute(this.webAppRoutes, parsedData.type || 'unknown');
      
      if (route) {
        await route.handler(ctx, parsedData);
      } else {
        await this.handleUnknownWebAppData(ctx, parsedData);
      }
      
    } catch (error) {
      this.logger.error('Web app data routing error:', error);
      await this.handleRoutingError(ctx, error, 'webapp');
    }
  }

  /**
   * Handle unknown routes
   */
  public async handleUnknownRoute(ctx: Context): Promise<void> {
    this.logger.warn('Unknown route encountered', {
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
      updateType: ctx.updateType
    });
    
    // Delegate to menu handler as fallback
    try {
      const menuHandler = this.resolve<MenuHandler>(ServiceIdentifiers.MenuHandler);
      await menuHandler.showMainMenu(ctx);
    } catch (error) {
      await ctx.reply('❌ An error occurred. Please try /start to reset your session.');
    }
  }

  /**
   * Register a new callback route
   */
  public registerCallbackRoute(pattern: string | RegExp, handler: (ctx: Context, data?: any) => Promise<void>, priority = 0): void {
    this.callbackRoutes.push({
      type: 'callback',
      pattern,
      handler,
      priority
    });
    
    // Sort routes by priority (higher priority first)
    this.callbackRoutes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    this.logger.debug(`Registered callback route: ${pattern}`);
  }

  /**
   * Register a new text route
   */
  public registerTextRoute(pattern: string | RegExp, handler: (ctx: Context, data?: any) => Promise<void>, priority = 0): void {
    this.textRoutes.push({
      type: 'text',
      pattern,
      handler,
      priority
    });
    
    this.textRoutes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.logger.debug(`Registered text route: ${pattern}`);
  }

  /**
   * Register a new document route
   */
  public registerDocumentRoute(
    pattern: string | RegExp,
    handler: (ctx: Context, data?: any) => Promise<void>,
    mimeTypes?: string[],
    priority = 0
  ): void {
    this.documentRoutes.push({
      type: 'document',
      pattern,
      handler,
      mimeTypes,
      priority
    });
    
    this.documentRoutes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.logger.debug(`Registered document route: ${pattern}`);
  }

  /**
   * Register a new web app route
   */
  public registerWebAppRoute(pattern: string | RegExp, handler: (ctx: Context, data?: any) => Promise<void>, priority = 0): void {
    this.webAppRoutes.push({
      type: 'webapp',
      pattern,
      handler,
      priority
    });
    
    this.webAppRoutes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.logger.debug(`Registered web app route: ${pattern}`);
  }

  /**
   * Get routing statistics
   */
  public getRoutingStats(): {
    callbackRoutes: number;
    textRoutes: number;
    documentRoutes: number;
    webAppRoutes: number;
    totalRoutes: number;
  } {
    return {
      callbackRoutes: this.callbackRoutes.length,
      textRoutes: this.textRoutes.length,
      documentRoutes: this.documentRoutes.length,
      webAppRoutes: this.webAppRoutes.length,
      totalRoutes: this.callbackRoutes.length + this.textRoutes.length + this.documentRoutes.length + this.webAppRoutes.length
    };
  }

  // Private helper methods

  private initializeRoutes(): void {
    // Register core callback routes
    this.registerCallbackRoutes();
    
    // Register core text routes
    this.registerTextRoutes();
    
    // Register core document routes
    this.registerDocumentRoutes();
    
    // Register core web app routes
    this.registerWebAppRoutes();
  }

  private registerCallbackRoutes(): void {
    // Menu routes
    this.registerCallbackRoute(/^menu_(.+)$/, async (ctx, data) => {
      const menuHandler = this.resolve<MenuHandler>(ServiceIdentifiers.MenuHandler);
      await menuHandler.handleCallback(ctx);
    }, 100);

    // Task routes
    this.registerCallbackRoute(/^task_(.+)$/, async (ctx, data) => {
      const taskHandler = this.resolve<TaskHandler>(ServiceIdentifiers.TaskHandler);
      await taskHandler.handleCallback(ctx);
    }, 100);

    // Wallet routes
    this.registerCallbackRoute(/^wallet_(.+)$/, async (ctx, data) => {
      const walletHandler = this.resolve<WalletHandler>(ServiceIdentifiers.WalletHandler);
      await walletHandler.handleCallback(ctx);
    }, 100);

    // Points routes
    this.registerCallbackRoute(/^points_(.+)$/, async (ctx, data) => {
      const pointsHandler = this.resolve<PointsHandler>(ServiceIdentifiers.PointsHandler);
      await pointsHandler.handleCallback(ctx);
    }, 100);

    // Referral routes
    this.registerCallbackRoute(/^referral_(.+)$/, async (ctx, data) => {
      const referralHandler = this.resolve<ReferralHandler>(ServiceIdentifiers.ReferralHandler);
      await referralHandler.handleCallback(ctx);
    }, 100);

    // Admin routes
    this.registerCallbackRoute(/^admin_(.+)$/, async (ctx, data) => {
      const adminHandler = this.resolve(ServiceIdentifiers.AdminHandler);
      // This will be replaced with AdminRouterService later
      await ctx.reply('🔧 Admin functionality - routing to admin panel...');
    }, 100);

    // Captcha routes
    this.registerCallbackRoute(/^captcha_(.+)$/, async (ctx, data) => {
      const captchaOrchestration = this.resolve<any>(ServiceIdentifiers.CaptchaOrchestration);
      await captchaOrchestration.handleCaptchaResponse(ctx, data.matches[1]);
    }, 100);
  }

  private registerTextRoutes(): void {
    // Referral code handling
    this.registerTextRoute(/^[A-Za-z0-9]{6,}$/, async (ctx, data) => {
      const userRegistration = this.resolve<any>(ServiceIdentifiers.UserRegistration);
      const userId = ctx.from?.id?.toString();
      if (userId) {
        await userRegistration.processReferralCode?.(userId, data.match);
      }
    }, 50);

    // Task submission text
    this.registerTextRoute(/^TASK_SUBMIT:(.+)$/, async (ctx, data) => {
      const taskHandler = this.resolve<TaskHandler>(ServiceIdentifiers.TaskHandler);
      await taskHandler.submitTask(ctx, data.matches[1]);
    }, 100);
  }

  private registerDocumentRoutes(): void {
    // Task submission documents
    this.registerDocumentRoute(
      /^task_submission$/,
      async (ctx, data) => {
        const taskHandler = this.resolve<TaskHandler>(ServiceIdentifiers.TaskHandler);
        await taskHandler.handleDocumentUpload(ctx);
      },
      ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
      100
    );
  }

  private registerWebAppRoutes(): void {
    // Captcha verification
    this.registerWebAppRoute('captcha_result', async (ctx, data) => {
      const captchaOrchestration = this.resolve<any>(ServiceIdentifiers.CaptchaOrchestration);
      await captchaOrchestration.handleCaptchaResponse(ctx, data);
    }, 100);

    // Task submission via web app
    this.registerWebAppRoute('task_submission', async (ctx, data) => {
      const taskHandler = this.resolve<any>(ServiceIdentifiers.TaskHandler);
      await taskHandler.submitTask(ctx, data);
    }, 100);
  }

  private findMatchingRoute<T extends RouteHandler>(routes: T[], input: string): T | null {
    for (const route of routes) {
      if (typeof route.pattern === 'string') {
        if (route.pattern === input) {
          return route;
        }
      } else if (route.pattern instanceof RegExp) {
        if (route.pattern.test(input)) {
          return route;
        }
      }
    }
    return null;
  }

  private findMatchingDocumentRoute(document: any): DocumentRoute | null {
    for (const route of this.documentRoutes) {
      // Check MIME type if specified
      if (route.mimeTypes && route.mimeTypes.length > 0) {
        if (!route.mimeTypes.includes(document.mime_type)) {
          continue;
        }
      }
      
      // Check pattern against filename
      const filename = document.file_name || '';
      if (typeof route.pattern === 'string') {
        if (route.pattern === filename) {
          return route;
        }
      } else if (route.pattern instanceof RegExp) {
        if (route.pattern.test(filename)) {
          return route;
        }
      }
    }
    return null;
  }

  private extractRouteData(pattern: string | RegExp, input: string): any {
    if (pattern instanceof RegExp) {
      const matches = input.match(pattern);
      return { matches: matches || [], match: input };
    }
    return { match: input };
  }

  private async handleUnknownCallback(ctx: Context, callbackData: string): Promise<void> {
    this.logger.warn(`Unknown callback: ${callbackData}`);
    
    try {
      await ctx.answerCbQuery('❌ Unknown action. Please try again.');
      await this.handleUnknownRoute(ctx);
    } catch (error) {
      this.logger.error('Error handling unknown callback:', error);
    }
  }

  private async handleUnknownText(ctx: Context, text: string): Promise<void> {
    this.logger.debug(`Unhandled text message: ${text.substring(0, 50)}...`);
    
    // For now, show menu as fallback
    await this.handleUnknownRoute(ctx);
  }

  private async handleUnknownDocument(ctx: Context, document: any): Promise<void> {
    this.logger.debug(`Unhandled document: ${document.file_name}, MIME: ${document.mime_type}`);
    
    await ctx.reply('📎 Document received, but no handler found. Please use the menu to navigate properly.');
  }

  private async handleUnknownWebAppData(ctx: Context, data: any): Promise<void> {
    this.logger.warn('Unknown web app data type:', data);
    
    await ctx.reply('❌ Unknown web app data received. Please try again.');
  }

  private async handleRoutingError(ctx: Context, error: any, routeType: string): Promise<void> {
    this.logger.error(`${routeType} routing error:`, error);
    
    try {
      if (routeType === 'callback') {
        await ctx.answerCbQuery('❌ An error occurred. Please try again.');
      }
      
      await ctx.reply('❌ An error occurred while processing your request. Please try again or use /menu.');
    } catch (replyError) {
      this.logger.error('Failed to send error message:', replyError);
    }
  }

  /**
   * Dispose of resources
   */
  public async dispose(): Promise<void> {
    this.callbackRoutes.length = 0;
    this.textRoutes.length = 0;
    this.documentRoutes.length = 0;
    this.webAppRoutes.length = 0;
  }
}