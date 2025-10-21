import { Context, Telegraf } from 'telegraf';

/**
 * Interface for bot lifecycle management
 */
export interface IBotLifecycleService {
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(signal?: string): Promise<void>;
  getInstance(): Telegraf;
  isInitialized(): boolean;
}

/**
 * Interface for command handling
 */
export interface ICommandHandlerService {
  setupCommands(bot: Telegraf): Promise<void>;
  handleStart(ctx: Context): Promise<void>;
  handleHelp(ctx: Context): Promise<void>;
  handleMenu(ctx: Context): Promise<void>;
  handlePoints(ctx: Context): Promise<void>;
  handleTasks(ctx: Context): Promise<void>;
  handleWallet(ctx: Context): Promise<void>;
  handleReferrals(ctx: Context): Promise<void>;
  handleStats(ctx: Context): Promise<void>;
  handleAdmin(ctx: Context): Promise<void>;
}

/**
 * Interface for user registration and management
 */
export interface IUserRegistrationService {
  ensureUserExistsForCommand(ctx: Context): Promise<boolean>;
  registerNewUser(ctx: Context): Promise<void>;
  welcomeBackUser(ctx: Context, user: any): Promise<void>;
  completeUserRegistration(ctx: Context, user: any): Promise<void>;
  extractReferralCode(ctx: Context): string | null;
  resolveReferralCode(code: string | null): Promise<string | null>;
}

/**
 * Interface for captcha validation
 */
export interface ICaptchaValidationService {
  shouldRequireCaptcha(user: any, isNewUser: boolean): Promise<boolean>;
  getNextCaptchaType(userId: string): Promise<'miniapp' | 'svg' | null>;
  hasCompletedAllCaptchas(userId: string): Promise<boolean>;
  promptForCaptcha(ctx: Context, type: 'registration' | 'verification'): Promise<void>;
  showMiniappCaptcha(ctx: Context, type: 'registration' | 'verification'): Promise<void>;
  showSvgCaptchaPrompt(ctx: Context, type: 'registration' | 'verification'): Promise<void>;
  handleCaptchaCallback(ctx: Context): Promise<void>;
  handleSvgCaptchaAnswer(ctx: Context, answer: string): Promise<void>;
  handleCaptchaCompletion(ctx: Context, data: any): Promise<void>;
  generateMiniappCaptchaUrl(userId: string): Promise<string>;
}

/**
 * Interface for message routing and handling
 */
export interface IMessageRoutingService {
  setupHandlers(bot: Telegraf): Promise<void>;
  handleCallback(ctx: Context): Promise<void>;
  handleTextMessage(ctx: Context): Promise<void>;
  handleWebAppData(ctx: Context): Promise<void>;
  handleDocumentUpload(ctx: Context): Promise<void>;
  handlePhotoUpload(ctx: Context): Promise<void>;
}

/**
 * Interface for bot middleware management
 */
export interface IBotMiddlewareService {
  setupMiddleware(bot: Telegraf): Promise<void>;
  setupErrorHandling(bot: Telegraf): void;
  setupScenes(bot: Telegraf): Promise<void>;
  setBotCommands(bot: Telegraf): Promise<void>;
}