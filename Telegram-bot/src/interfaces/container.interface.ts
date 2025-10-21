/**
 * Service identifier type for dependency injection
 */
export type ServiceIdentifier<T = {}> = string | symbol | Function | { new (...args: any[]): T };

/**
 * Interface for dependency injection container
 */
export interface IContainer {
  /**
   * Bind a service to the container
   */
  bind<T>(serviceIdentifier: ServiceIdentifier<T>): IBindingToSyntax<T>;
  
  /**
   * Get a service from the container
   */
  get<T>(serviceIdentifier: ServiceIdentifier<T>): T;
  
  /**
   * Check if a service is bound
   */
  isBound<T>(serviceIdentifier: ServiceIdentifier<T>): boolean;
  
  /**
   * Unbind a service
   */
  unbind<T>(serviceIdentifier: ServiceIdentifier<T>): void;
  
  /**
   * Rebind a service
   */
  rebind<T>(serviceIdentifier: ServiceIdentifier<T>): IBindingToSyntax<T>;
}

/**
 * Interface for binding syntax
 */
export interface IBindingToSyntax<T> {
  to(constructor: { new (...args: any[]): T }): IBindingInSyntax<T>;
  toConstantValue(value: T): IBindingWhenSyntax<T>;
  toFactory(factory: () => T): IBindingWhenSyntax<T>;
  toFunction(func: T): IBindingWhenSyntax<T>;
}

/**
 * Interface for binding in syntax
 */
export interface IBindingInSyntax<T> {
  inSingletonScope(): IBindingWhenSyntax<T>;
  inTransientScope(): IBindingWhenSyntax<T>;
}

/**
 * Interface for binding when syntax
 */
export interface IBindingWhenSyntax<T> {
  when(constraint: (request: any) => boolean): void;
  whenTargetNamed(name: string | symbol): void;
  whenTargetTagged(tag: string | symbol, value: any): void;
}

/**
 * Service identifiers for all services
 */
export const TYPES = {
  // Bot services
  BotLifecycleService: Symbol('BotLifecycleService'),
  CommandHandlerService: Symbol('CommandHandlerService'),
  UserRegistrationService: Symbol('UserRegistrationService'),
  CaptchaValidationService: Symbol('CaptchaValidationService'),
  MessageRoutingService: Symbol('MessageRoutingService'),
  BotMiddlewareService: Symbol('BotMiddlewareService'),
  
  // Admin services
  AdminAuthorizationService: Symbol('AdminAuthorizationService'),
  SystemStatsService: Symbol('SystemStatsService'),
  UserManagementService: Symbol('UserManagementService'),
  TaskManagementService: Symbol('TaskManagementService'),
  SecurityControlService: Symbol('SecurityControlService'),
  AdminUIService: Symbol('AdminUIService'),
  
  // Common services
  Logger: Symbol('Logger'),
  StorageManager: Symbol('StorageManager'),
  SecurityManager: Symbol('SecurityManager'),
  Config: Symbol('Config')
} as const;