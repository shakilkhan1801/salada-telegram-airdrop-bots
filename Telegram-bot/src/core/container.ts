/**
 * Dependency Injection Container for Service Management
 * Implements IoC pattern with singleton and transient lifecycle management
 */

export interface ServiceConstructor<T = any> {
  new (...args: any[]): T;
}

export interface ServiceDescriptor {
  implementation: ServiceConstructor;
  lifecycle: 'singleton' | 'transient';
  dependencies?: string[];
}

export type ServiceIdentifier = string | symbol;

/**
 * Enterprise IoC Container with lifecycle management
 */
export class Container {
  private static instance: Container;
  private services: Map<ServiceIdentifier, ServiceDescriptor> = new Map();
  private singletonInstances: Map<ServiceIdentifier, any> = new Map();
  private readonly logger: any; // Will be injected properly

  private constructor() {
    // Initialize basic logging
    this.logger = console; // Temporary - will be replaced with proper logger
  }

  public static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  /**
   * Register a service with the container
   */
  register<T>(
    identifier: ServiceIdentifier,
    implementation: ServiceConstructor<T>,
    lifecycle: 'singleton' | 'transient' = 'singleton',
    dependencies: string[] = []
  ): void {
    this.services.set(identifier, {
      implementation,
      lifecycle,
      dependencies
    });

    this.logger.debug(`Service registered: ${String(identifier)}`);
  }

  /**
   * Register an existing instance as a singleton
   */
  registerInstance<T>(identifier: ServiceIdentifier, instance: T): void {
    // Create a dummy descriptor since the instance already exists
    this.services.set(identifier, {
      implementation: class {} as any,
      lifecycle: 'singleton',
      dependencies: []
    });
    
    // Store the existing instance
    this.singletonInstances.set(identifier, instance);
    
    this.logger.debug(`Instance registered: ${String(identifier)}`);
  }

  /**
   * Register multiple services at once
   */
  registerBatch(services: Array<{
    identifier: ServiceIdentifier;
    implementation: ServiceConstructor;
    lifecycle?: 'singleton' | 'transient';
    dependencies?: string[];
  }>): void {
    services.forEach(({ identifier, implementation, lifecycle, dependencies }) => {
      this.register(identifier, implementation, lifecycle, dependencies);
    });
  }

  /**
   * Resolve a service instance
   */
  resolve<T>(identifier: ServiceIdentifier): T {
    const descriptor = this.services.get(identifier);
    
    if (!descriptor) {
      throw new Error(`Service not registered: ${String(identifier)}`);
    }

    // Return existing singleton instance if available
    if (descriptor.lifecycle === 'singleton' && this.singletonInstances.has(identifier)) {
      return this.singletonInstances.get(identifier);
    }

    // Resolve dependencies
    const dependencyInstances = this.resolveDependencies(descriptor.dependencies || []);

    // Create new instance
    const instance = new descriptor.implementation(...dependencyInstances);

    // Store singleton instance
    if (descriptor.lifecycle === 'singleton') {
      this.singletonInstances.set(identifier, instance);
    }

    return instance;
  }

  /**
   * Resolve multiple services
   */
  resolveAll<T>(identifiers: ServiceIdentifier[]): T[] {
    return identifiers.map(id => this.resolve<T>(id));
  }

  /**
   * Check if a service is registered
   */
  isRegistered(identifier: ServiceIdentifier): boolean {
    return this.services.has(identifier);
  }

  /**
   * Remove a service registration
   */
  unregister(identifier: ServiceIdentifier): void {
    this.services.delete(identifier);
    this.singletonInstances.delete(identifier);
    this.logger.debug(`Service unregistered: ${String(identifier)}`);
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.services.clear();
    this.singletonInstances.clear();
    this.logger.debug('Container cleared');
  }

  /**
   * Get all registered service identifiers
   */
  getRegisteredServices(): ServiceIdentifier[] {
    return Array.from(this.services.keys());
  }

  /**
   * Dispose singleton instances that implement IDisposable
   */
  dispose(): void {
    this.singletonInstances.forEach((instance, identifier) => {
      if (instance && typeof instance.dispose === 'function') {
        try {
          instance.dispose();
          this.logger.debug(`Service disposed: ${String(identifier)}`);
        } catch (error) {
          this.logger.error(`Error disposing service ${String(identifier)}:`, error);
        }
      }
    });

    this.singletonInstances.clear();
  }

  private resolveDependencies(dependencies: string[]): any[] {
    return dependencies.map(dep => this.resolve(dep));
  }
}

/**
 * Service Identifiers - Centralized service keys
 */
export const ServiceIdentifiers = {
  // Core Services
  Logger: Symbol.for('Logger'),
  Config: Symbol.for('Config'),
  Storage: Symbol.for('Storage'),
  Security: Symbol.for('Security'),

  // Bot Services
  BotLifecycle: Symbol.for('BotLifecycle'),
  CommandRegistration: Symbol.for('CommandRegistration'),
  RequestRouting: Symbol.for('RequestRouting'),
  UserRegistration: Symbol.for('UserRegistration'),
  UserSession: Symbol.for('UserSession'),
  CaptchaOrchestration: Symbol.for('CaptchaOrchestration'),
  BotMonitoring: Symbol.for('BotMonitoring'),
  BotBroadcast: Symbol.for('BotBroadcast'),

  // Admin Services
  AdminAuth: Symbol.for('AdminAuth'),
  AdminUI: Symbol.for('AdminUI'),
  AdminAnalytics: Symbol.for('AdminAnalytics'),
  AdminStats: Symbol.for('AdminStats'),
  AdminSecurity: Symbol.for('AdminSecurity'),
  AdminTaskReview: Symbol.for('AdminTaskReview'),
  SystemAdmin: Symbol.for('SystemAdmin'),
  AdminScene: Symbol.for('AdminScene'),
  AdminBroadcast: Symbol.for('AdminBroadcast'),
  AdminUser: Symbol.for('AdminUser'),
  AdminRouter: Symbol.for('AdminRouter'),

  // Handlers (Legacy)
  MenuHandler: Symbol.for('MenuHandler'),
  TaskHandler: Symbol.for('TaskHandler'),
  WalletHandler: Symbol.for('WalletHandler'),
  ReferralHandler: Symbol.for('ReferralHandler'),
  PointsHandler: Symbol.for('PointsHandler'),
  AdminHandler: Symbol.for('AdminHandler'),
  TaskAdminHandler: Symbol.for('TaskAdminHandler'),

  // Additional Services
  CaptchaService: Symbol.for('CaptchaService'),
  ErrorHandler: Symbol.for('ErrorHandler'),
  AccountProtection: Symbol.for('AccountProtection'),
  UserFactory: Symbol.for('UserFactory')
} as const;

/**
 * Service decorator for automatic registration
 */
export function Service(identifier: ServiceIdentifier, lifecycle: 'singleton' | 'transient' = 'singleton') {
  return function <T extends ServiceConstructor>(constructor: T): T {
    // Store metadata for later registration
    (constructor as any).__serviceMetadata = {
      identifier,
      lifecycle
    };
    return constructor;
  };
}

/**
 * Inject decorator for constructor dependency injection
 */
export function Inject(identifier: ServiceIdentifier) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    const existingMetadata = Reflect.getMetadata('inject', target) || [];
    existingMetadata[parameterIndex] = identifier;
    Reflect.defineMetadata('inject', existingMetadata, target);
  };
}

/**
 * IDisposable interface for services that need cleanup
 */
export interface IDisposable {
  dispose(): void | Promise<void>;
}

/**
 * Base service class with common functionality
 */
export abstract class BaseService implements IDisposable {
  protected readonly container: Container;

  constructor() {
    this.container = Container.getInstance();
  }

  protected resolve<T>(identifier: ServiceIdentifier): T {
    return this.container.resolve<T>(identifier);
  }

  public dispose(): void | Promise<void> {
    // Override in derived classes for cleanup
  }
}

/**
 * Container builder for fluent service registration
 */
export class ContainerBuilder {
  private registrations: Array<{
    identifier: ServiceIdentifier;
    implementation: ServiceConstructor;
    lifecycle: 'singleton' | 'transient';
    dependencies: string[];
  }> = [];
  
  private instances: Array<{
    identifier: ServiceIdentifier;
    instance: any;
  }> = [];

  public addSingleton<T>(
    identifier: ServiceIdentifier,
    implementation: ServiceConstructor<T>,
    dependencies: string[] = []
  ): ContainerBuilder {
    this.registrations.push({
      identifier,
      implementation,
      lifecycle: 'singleton',
      dependencies
    });
    return this;
  }

  public addTransient<T>(
    identifier: ServiceIdentifier,
    implementation: ServiceConstructor<T>,
    dependencies: string[] = []
  ): ContainerBuilder {
    this.registrations.push({
      identifier,
      implementation,
      lifecycle: 'transient',
      dependencies
    });
    return this;
  }

  public addInstance<T>(
    identifier: ServiceIdentifier,
    instance: T
  ): ContainerBuilder {
    this.instances.push({
      identifier,
      instance
    });
    return this;
  }

  public build(): Container {
    const container = Container.getInstance();
    
    // Register services first
    container.registerBatch(this.registrations);
    
    // Then register instances
    this.instances.forEach(({ identifier, instance }) => {
      container.registerInstance(identifier, instance);
    });
    
    return container;
  }
}

// Export singleton instance for convenience
export const container = Container.getInstance();