/**
 * Service Registration Configuration
 * Configures the dependency injection container with all services
 */

import { ContainerBuilder, ServiceIdentifiers, ServiceIdentifier } from './container';

// Core Services
import { Logger } from '../services/logger';
import { StorageManager } from '../storage';
import { SecurityManager } from '../security';
import { getConfig } from '../config';

// Bot Services
import { BotLifecycleService } from '../services/bot/bot-lifecycle.service';
import { CommandRegistrationService } from '../services/bot/command-registration.service';
import { RequestRoutingService } from '../services/bot/request-routing.service';

// Admin Services
import { AdminAuthService } from '../services/admin/admin-auth.service';

// Legacy Handlers (to be gradually replaced)
import { MenuHandler } from '../bot/handlers/menu-handler';
import { TaskHandler } from '../bot/handlers/task-handler';
import { WalletHandler } from '../bot/handlers/wallet-handler';
import { ReferralHandler } from '../bot/handlers/referral-handler';
import { PointsHandler } from '../bot/handlers/points-handler';
import { AdminHandler } from '../bot/handlers/admin-handler';
import { TaskAdminHandler } from '../bot/handlers/task-admin.handler';

// Additional Services
import { CaptchaService } from '../services/captcha-service';
import { ErrorHandlerService } from '../services/error-handler.service';
import { AccountProtectionService } from '../security/account-protection.service';
import { UserFactory } from '../factories/user-factory';

/**
 * Register all services with the dependency injection container
 */
export function registerServices(): void {
  const builder = new ContainerBuilder();

  // Core Services
  builder.addSingleton(ServiceIdentifiers.Logger, Logger);
  builder.addSingleton(ServiceIdentifiers.Storage, StorageManager);
  builder.addSingleton(ServiceIdentifiers.Security, SecurityManager);
  
  // Config as singleton factory
  builder.addSingleton(ServiceIdentifiers.Config, class ConfigService {
    constructor() {}
    static getInstance() {
      return getConfig();
    }
  });

  // Bot Services
  builder.addSingleton(ServiceIdentifiers.BotLifecycle, BotLifecycleService);
  builder.addSingleton(ServiceIdentifiers.CommandRegistration, CommandRegistrationService);
  builder.addSingleton(ServiceIdentifiers.RequestRouting, RequestRoutingService);

  // Admin Services
  builder.addSingleton(ServiceIdentifiers.AdminAuth, AdminAuthService);

  // Legacy Handlers (will be refactored gradually)
  builder.addSingleton(ServiceIdentifiers.MenuHandler, MenuHandler);
  builder.addSingleton(ServiceIdentifiers.TaskHandler, TaskHandler);
  builder.addSingleton(ServiceIdentifiers.WalletHandler, WalletHandler);
  builder.addSingleton(ServiceIdentifiers.ReferralHandler, ReferralHandler);
  builder.addSingleton(ServiceIdentifiers.PointsHandler, PointsHandler);
  builder.addSingleton(ServiceIdentifiers.AdminHandler, AdminHandler);
  builder.addSingleton(ServiceIdentifiers.TaskAdminHandler, TaskAdminHandler);

  // Additional Services (singleton instances)
  builder.addInstance(ServiceIdentifiers.CaptchaService, CaptchaService.getInstance());
  builder.addInstance(ServiceIdentifiers.ErrorHandler, ErrorHandlerService.getInstance());
  builder.addSingleton(ServiceIdentifiers.AccountProtection, AccountProtectionService);
  builder.addSingleton(ServiceIdentifiers.UserFactory, UserFactory);

  // Build the container
  builder.build();

  if ((process.env.NODE_ENV || '').toLowerCase() !== 'production') console.log('✅ All services registered successfully');
}

/**
 * Register additional services that will be created later
 */
export function registerAdditionalServices(): void {
  // This will be called as we create more services
  // For now, it's a placeholder for future service registrations
}

/**
 * Get service registration statistics
 */
export function getServiceRegistrationStats() {
  const container = require('./container').container;
  const services = container.getRegisteredServices();
  
  return {
    totalServices: services.length,
    registeredServices: services.map((id: ServiceIdentifier) => id.toString()),
    coreServices: [
      ServiceIdentifiers.Logger,
      ServiceIdentifiers.Storage,
      ServiceIdentifiers.Security,
      ServiceIdentifiers.Config
    ].filter(id => container.isRegistered(id)).length,
    botServices: [
      ServiceIdentifiers.BotLifecycle,
      ServiceIdentifiers.CommandRegistration,
      ServiceIdentifiers.RequestRouting
    ].filter(id => container.isRegistered(id)).length,
    adminServices: [
      ServiceIdentifiers.AdminAuth
    ].filter(id => container.isRegistered(id)).length
  };
}