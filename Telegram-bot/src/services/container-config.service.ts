import { Container } from './container.service';
import { TYPES } from '../interfaces/container.interface';

// Bot services
import { BotLifecycleService } from './bot/bot-lifecycle.service';
import { BotMiddlewareService } from './bot/bot-middleware.service';
import { CommandHandlerService } from './bot/command-handler.service';
import { UserRegistrationService } from './bot/user-registration.service';
import { CaptchaValidationService } from './bot/captcha-validation.service';

// Admin services
import { AdminAuthorizationService } from './admin/admin-authorization.service';
import { SystemStatsService } from './admin/system-stats.service';
import { UserManagementService } from './admin/user-management.service';
import { TaskManagementService } from './admin/task-management.service';
import { SecurityControlService } from './admin/security-control.service';
import { AdminUIService } from './admin/admin-ui.service';

// Message routing service
import { MessageRoutingService } from './bot/message-routing.service';

// Interfaces
import { 
  IBotLifecycleService, 
  IBotMiddlewareService, 
  ICommandHandlerService, 
  IUserRegistrationService,
  ICaptchaValidationService,
  IMessageRoutingService
} from '../interfaces/bot-services.interface';

import {
  IAdminAuthorizationService,
  ISystemStatsService,
  IUserManagementService,
  ITaskManagementService,
  ISecurityControlService,
  IAdminUIService
} from '../interfaces/admin-services.interface';

// Common services
import { Logger } from './logger';
import { StorageManager } from '../storage';
import { SecurityManager } from '../security';
import { getConfig } from '../config';

export class ContainerConfigService {
  private static isConfigured = false;

  static configureContainer(): void {
    if (this.isConfigured) {
      return;
    }

    const container = Container.getInstance();

    // Configure common services
    container.bind(TYPES.Logger).toConstantValue(Logger.getInstance());
    container.bind(TYPES.StorageManager).toConstantValue(StorageManager.getInstance());
    container.bind(TYPES.SecurityManager).toConstantValue(SecurityManager.getInstance());
    container.bind(TYPES.Config).toConstantValue(getConfig());

    // Configure bot services
    container.bind<IBotLifecycleService>(TYPES.BotLifecycleService).to(BotLifecycleService);
    container.bind<IBotMiddlewareService>(TYPES.BotMiddlewareService).to(BotMiddlewareService);
    container.bind<ICommandHandlerService>(TYPES.CommandHandlerService).to(CommandHandlerService);
    container.bind<IUserRegistrationService>(TYPES.UserRegistrationService).to(UserRegistrationService);
    container.bind<ICaptchaValidationService>(TYPES.CaptchaValidationService).to(CaptchaValidationService);

    // Configure message routing service
    container.bind<IMessageRoutingService>(TYPES.MessageRoutingService).to(MessageRoutingService);

    // Configure admin services
    container.bind<IAdminAuthorizationService>(TYPES.AdminAuthorizationService).to(AdminAuthorizationService);
    container.bind<ISystemStatsService>(TYPES.SystemStatsService).to(SystemStatsService);
    container.bind<IAdminUIService>(TYPES.AdminUIService).to(AdminUIService);
    
    // Admin services that depend on other admin services
    // Using factory functions since toDynamicValue is not implemented
    container.bind<IUserManagementService>(TYPES.UserManagementService).toFactory(() => {
      const authService = container.get<IAdminAuthorizationService>(TYPES.AdminAuthorizationService);
      const uiService = container.get<IAdminUIService>(TYPES.AdminUIService);
      return new UserManagementService(authService, uiService);
    });
    
    container.bind<ITaskManagementService>(TYPES.TaskManagementService).toFactory(() => {
      const authService = container.get<IAdminAuthorizationService>(TYPES.AdminAuthorizationService);
      const uiService = container.get<IAdminUIService>(TYPES.AdminUIService);
      return new TaskManagementService(authService, uiService);
    });
    
    container.bind<ISecurityControlService>(TYPES.SecurityControlService).toFactory(() => {
      const authService = container.get<IAdminAuthorizationService>(TYPES.AdminAuthorizationService);
      const uiService = container.get<IAdminUIService>(TYPES.AdminUIService);
      return new SecurityControlService(authService, uiService);
    });

    this.isConfigured = true;
  }

  static resetConfiguration(): void {
    const container = Container.getInstance();
    container.clear();
    this.isConfigured = false;
  }
}