import { getTraceId, runWithTrace } from '../src/services/trace';

describe('Trace context', () => {
  it('propagates trace_id in context', () => {
    runWithTrace('test-trace-123', () => {
      expect(getTraceId()).toBe('test-trace-123');
    });
  });
});
