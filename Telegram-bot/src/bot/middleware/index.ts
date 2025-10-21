export { BlockingMiddleware } from './blocking.middleware';
export { MaintenanceMiddleware } from './maintenance.middleware';

import { BlockingMiddleware } from './blocking.middleware';
import { MaintenanceMiddleware } from './maintenance.middleware';
import { FastAckMiddleware } from './fast-ack.middleware';
import { MiddlewareFn, Context } from 'telegraf';

/**
 * Create all bot middlewares in the correct order
 */
export function createBotMiddlewares(): MiddlewareFn<Context>[] {
  const fastAck = FastAckMiddleware.getInstance();
  const blockingMiddleware = BlockingMiddleware.getInstance();
  const maintenanceMiddleware = MaintenanceMiddleware.getInstance();

  return [
    // Always ACK callback queries instantly to stop spinner
    fastAck.create(),
    // Check if user is blocked
    blockingMiddleware.create(),
    // Then check maintenance/bot status (admins can bypass)
    maintenanceMiddleware.create()
  ];
}

/**
 * Get individual middleware instances for advanced usage
 */
export function getMiddlewareInstances() {
  return {
    blocking: BlockingMiddleware.getInstance(),
    maintenance: MaintenanceMiddleware.getInstance()
  };
}
