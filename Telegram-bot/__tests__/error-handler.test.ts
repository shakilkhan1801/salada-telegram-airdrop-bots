import { ErrorHandlerService } from '../src/services/error-handler.service';

describe('ErrorHandlerService', () => {
  it('wraps promises with timeout', async () => {
    const svc = ErrorHandlerService.getInstance();
    await svc.initialize();

    const fast = svc.withTimeout(Promise.resolve('ok'), 50);
    await expect(fast).resolves.toBe('ok');

    const slow = svc.withTimeout(new Promise((r) => setTimeout(() => r('late'), 100)), 20);
    await expect(slow).rejects.toHaveProperty('name', 'TimeoutError');
  });
});
