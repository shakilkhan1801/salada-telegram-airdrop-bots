/**
 * Enterprise Rate Limiting Test Suite
 * 
 * Comprehensive test coverage for IPv6/IPv4 rate limiting scenarios,
 * security features, and edge cases for large-scale production systems.
 * 
 * @version 1.0.0
 * @author Security Testing Team
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Request, Response } from 'express';
import { rateLimitingService, RateLimitingService } from '../../src/services/security/rate-limiting.service';

/**
 * Mock Express Request with customizable IP and headers
 */
class MockRequest {
  public headers: Record<string, string | string[]> = {};
  public ip = '127.0.0.1';
  public connection = { remoteAddress: '127.0.0.1' };
  public socket = { remoteAddress: '127.0.0.1' };
  public path = '/test';
  public method = 'GET';

  constructor(overrides: Partial<MockRequest> = {}) {
    Object.assign(this, overrides);
  }

  static createIPv4Request(ip = '192.168.1.100'): MockRequest {
    return new MockRequest({
      ip,
      connection: { remoteAddress: ip },
      headers: {
        'user-agent': 'Test-Agent/1.0',
        'accept': 'application/json'
      }
    });
  }

  static createIPv6Request(ip = '2001:db8::1'): MockRequest {
    return new MockRequest({
      ip,
      connection: { remoteAddress: ip },
      headers: {
        'user-agent': 'Test-Agent/1.0',
        'accept': 'application/json'
      }
    });
  }

  static createProxiedRequest(realIP: string, proxyHeaders: Record<string, string> = {}): MockRequest {
    return new MockRequest({
      ip: '10.0.0.1', // Proxy IP
      connection: { remoteAddress: '10.0.0.1' },
      headers: {
        'x-forwarded-for': realIP,
        'x-real-ip': realIP,
        'user-agent': 'Test-Agent/1.0',
        ...proxyHeaders
      }
    });
  }
}

/**
 * Mock Express Response
 */
class MockResponse {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public body: any = null;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  set(headers: Record<string, string> | string, value?: string): this {
    if (typeof headers === 'string' && value) {
      this.headers[headers] = value;
    } else if (typeof headers === 'object') {
      Object.assign(this.headers, headers);
    }
    return this;
  }

  get(header: string): string | undefined {
    return this.headers[header];
  }

  json(data: any): this {
    this.body = data;
    return this;
  }
}

describe('Enterprise Rate Limiting Service - IPv6/IPv4 Comprehensive Tests', () => {
  let service: RateLimitingService;\n  let mockReq: MockRequest;\n  let mockRes: MockResponse;\n  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;\n  let consoleInfoSpy: jest.SpiedFunction<typeof console.info>;

  beforeEach(() => {\n    service = RateLimitingService.getInstance();\n    mockReq = new MockRequest();\n    mockRes = new MockResponse();\n    service.resetMetrics();\n    \n    // Spy on console methods\n    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();\n    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();\n  });

  afterEach(() => {\n    jest.restoreAllMocks();\n  });

  describe('IPv6 Address Handling', () => {\n    it('should correctly identify IPv6 addresses', async () => {\n      const ipv6Request = MockRequest.createIPv6Request('2001:db8::1');\n      const rateLimiter = service.createRateLimit({\n        id: 'test-ipv6',\n        name: 'IPv6 Test Policy',\n        windowMs: 60000,\n        maxRequests: 10\n      });\n      \n      // First request should pass\n      await new Promise<void>((resolve) => {\n        rateLimiter(ipv6Request as any, mockRes as any, () => {\n          expect(mockRes.statusCode).not.toBe(429);\n          resolve();\n        });\n      });\n      \n      const metrics = service.getMetrics();\n      expect(metrics.ipv6Requests).toBeGreaterThan(0);\n      expect(metrics.totalRequests).toBeGreaterThan(0);\n    });\n\n    it('should handle IPv6 address normalization', () => {\n      const testCases = [\n        '2001:db8::1',\n        '2001:0db8:0000:0000:0000:0000:0000:0001',\n        '::1',\n        'fe80::1%lo0'\n      ];\n      \n      testCases.forEach(ipv6 => {\n        const req = MockRequest.createIPv6Request(ipv6);\n        const rateLimiter = service.createRateLimit({\n          id: `test-normalize-${ipv6.replace(/[^a-zA-Z0-9]/g, '_')}`,\n          name: 'IPv6 Normalization Test',\n          windowMs: 60000,\n          maxRequests: 5\n        });\n        \n        expect(() => {\n          rateLimiter(req as any, mockRes as any, () => {});\n        }).not.toThrow();\n      });\n    });\n\n    it('should prevent IPv6 bypass attacks', async () => {\n      const attackVectors = [\n        '2001:db8::1',\n        '2001:0db8::0001', // Different representation, same address\n        '2001:db8:0:0:0:0:0:1' // Another representation\n      ];\n      \n      const rateLimiter = service.createRateLimit({\n        id: 'ipv6-bypass-test',\n        name: 'IPv6 Bypass Prevention',\n        windowMs: 60000,\n        maxRequests: 2\n      });\n      \n      let blockedCount = 0;\n      \n      for (const ip of attackVectors) {\n        const req = MockRequest.createIPv6Request(ip);\n        await new Promise<void>((resolve) => {\n          rateLimiter(req as any, mockRes as any, () => {\n            if (mockRes.statusCode === 429) blockedCount++;\n            resolve();\n          });\n        });\n      }\n      \n      // Should block at least some requests due to normalization\n      expect(blockedCount).toBeGreaterThan(0);\n    });\n  });

  describe('IPv4 Address Handling', () => {\n    it('should correctly identify IPv4 addresses', async () => {\n      const ipv4Request = MockRequest.createIPv4Request('192.168.1.100');\n      const rateLimiter = service.createRateLimit({\n        id: 'test-ipv4',\n        name: 'IPv4 Test Policy',\n        windowMs: 60000,\n        maxRequests: 10\n      });\n      \n      await new Promise<void>((resolve) => {\n        rateLimiter(ipv4Request as any, mockRes as any, () => {\n          resolve();\n        });\n      });\n      \n      const metrics = service.getMetrics();\n      expect(metrics.ipv4Requests).toBeGreaterThan(0);\n    });\n\n    it('should handle private IPv4 ranges correctly', () => {\n      const privateIPs = [\n        '192.168.1.1',\n        '10.0.0.1',\n        '172.16.0.1',\n        '127.0.0.1'\n      ];\n      \n      privateIPs.forEach(ip => {\n        const req = MockRequest.createIPv4Request(ip);\n        const rateLimiter = service.createRateLimit({\n          id: `test-private-${ip.replace(/\\./g, '_')}`,\n          name: 'Private IP Test',\n          windowMs: 60000,\n          maxRequests: 5\n        });\n        \n        expect(() => {\n          rateLimiter(req as any, mockRes as any, () => {});\n        }).not.toThrow();\n      });\n    });\n  });

  describe('Proxy and Load Balancer Support', () => {\n    beforeEach(() => {\n      service.updateSecurityConfig({\n        trustProxy: true,\n        enableIPv6: true\n      });\n    });\n\n    it('should extract real IP from X-Forwarded-For header', async () => {\n      const realIP = '203.0.113.1';\n      const proxiedRequest = MockRequest.createProxiedRequest(realIP);\n      \n      const rateLimiter = service.createRateLimit({\n        id: 'proxy-test',\n        name: 'Proxy IP Extraction Test',\n        windowMs: 60000,\n        maxRequests: 5\n      });\n      \n      // Make multiple requests from same real IP\n      for (let i = 0; i < 6; i++) {\n        await new Promise<void>((resolve) => {\n          rateLimiter(proxiedRequest as any, mockRes as any, () => {\n            resolve();\n          });\n        });\n      }\n      \n      // Should be rate limited based on real IP, not proxy IP\n      expect(mockRes.statusCode).toBe(429);\n    });\n\n    it('should handle IPv6 addresses in proxy headers', async () => {\n      const ipv6RealIP = '2001:db8::100';\n      const proxiedIPv6Request = MockRequest.createProxiedRequest(ipv6RealIP);\n      \n      const rateLimiter = service.createRateLimit({\n        id: 'ipv6-proxy-test',\n        name: 'IPv6 Proxy Test',\n        windowMs: 60000,\n        maxRequests: 3\n      });\n      \n      let requestCount = 0;\n      \n      for (let i = 0; i < 5; i++) {\n        await new Promise<void>((resolve) => {\n          rateLimiter(proxiedIPv6Request as any, mockRes as any, () => {\n            requestCount++;\n            resolve();\n          });\n        });\n      }\n      \n      const metrics = service.getMetrics();\n      expect(metrics.ipv6Requests).toBeGreaterThan(0);\n      expect(mockRes.statusCode).toBe(429); // Should be rate limited\n    });\n  });\n\n  describe('Security Features', () => {\n    it('should implement device fingerprinting', async () => {\n      service.updateSecurityConfig({\n        enableFingerprinting: true\n      });\n      \n      const req1 = MockRequest.createIPv4Request('192.168.1.1');\n      req1.headers['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';\n      \n      const req2 = MockRequest.createIPv4Request('192.168.1.1');\n      req2.headers['user-agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';\n      \n      const rateLimiter = service.createRateLimit({\n        id: 'fingerprint-test',\n        name: 'Device Fingerprinting Test',\n        windowMs: 60000,\n        maxRequests: 2\n      });\n      \n      // Different user agents should be treated as different clients\n      await new Promise<void>((resolve) => {\n        rateLimiter(req1 as any, mockRes as any, () => resolve());\n      });\n      \n      await new Promise<void>((resolve) => {\n        rateLimiter(req2 as any, mockRes as any, () => resolve());\n      });\n      \n      const metrics = service.getMetrics();\n      expect(metrics.fingerprintedRequests).toBeGreaterThan(0);\n    });\n\n    it('should respect IP whitelist', async () => {\n      service.updateSecurityConfig({\n        whitelist: ['192.168.1.100', '2001:db8::1']\n      });\n      \n      const whitelistedIPv4 = MockRequest.createIPv4Request('192.168.1.100');\n      const whitelistedIPv6 = MockRequest.createIPv6Request('2001:db8::1');\n      const normalIP = MockRequest.createIPv4Request('203.0.113.1');\n      \n      const rateLimiter = service.createRateLimit({\n        id: 'whitelist-test',\n        name: 'Whitelist Test',\n        windowMs: 60000,\n        maxRequests: 1\n      });\n      \n      // Whitelisted IPs should not be rate limited\n      for (let i = 0; i < 5; i++) {\n        await new Promise<void>((resolve) => {\n          rateLimiter(whitelistedIPv4 as any, mockRes as any, () => {\n            expect(mockRes.statusCode).not.toBe(429);\n            resolve();\n          });\n        });\n      }\n      \n      // Normal IP should be rate limited after first request\n      await new Promise<void>((resolve) => {\n        rateLimiter(normalIP as any, mockRes as any, () => resolve());\n      });\n      \n      await new Promise<void>((resolve) => {\n        rateLimiter(normalIP as any, mockRes as any, () => {\n          expect(mockRes.statusCode).toBe(429);\n          resolve();\n        });\n      });\n    });\n  });\n\n  describe('Metrics and Monitoring', () => {\n    it('should track IPv4 vs IPv6 requests separately', async () => {\n      const rateLimiter = service.createRateLimit({\n        id: 'metrics-test',\n        name: 'Metrics Test',\n        windowMs: 60000,\n        maxRequests: 10\n      });\n      \n      // Make IPv4 requests\n      for (let i = 0; i < 3; i++) {\n        const req = MockRequest.createIPv4Request(`192.168.1.${i + 1}`);\n        await new Promise<void>((resolve) => {\n          rateLimiter(req as any, mockRes as any, () => resolve());\n        });\n      }\n      \n      // Make IPv6 requests\n      for (let i = 0; i < 2; i++) {\n        const req = MockRequest.createIPv6Request(`2001:db8::${i + 1}`);\n        await new Promise<void>((resolve) => {\n          rateLimiter(req as any, mockRes as any, () => resolve());\n        });\n      }\n      \n      const metrics = service.getMetrics();\n      expect(metrics.ipv4Requests).toBe(3);\n      expect(metrics.ipv6Requests).toBe(2);\n      expect(metrics.totalRequests).toBe(5);\n    });\n\n    it('should track blocked requests', async () => {\n      const rateLimiter = service.createRateLimit({\n        id: 'blocked-metrics-test',\n        name: 'Blocked Metrics Test',\n        windowMs: 60000,\n        maxRequests: 2\n      });\n      \n      const req = MockRequest.createIPv4Request('203.0.113.1');\n      \n      // Make requests that will be blocked\n      for (let i = 0; i < 5; i++) {\n        await new Promise<void>((resolve) => {\n          rateLimiter(req as any, mockRes as any, () => resolve());\n        });\n      }\n      \n      const metrics = service.getMetrics();\n      expect(metrics.blockedRequests).toBeGreaterThan(0);\n    });\n  });\n\n  describe('Error Handling and Edge Cases', () => {\n    it('should handle malformed IP addresses gracefully', () => {\n      const malformedRequests = [\n        new MockRequest({ ip: 'invalid-ip' }),\n        new MockRequest({ ip: '' }),\n        new MockRequest({ ip: '999.999.999.999' }),\n        new MockRequest({ ip: 'gggg::1111' })\n      ];\n      \n      malformedRequests.forEach((req, index) => {\n        const rateLimiter = service.createRateLimit({\n          id: `malformed-test-${index}`,\n          name: 'Malformed IP Test',\n          windowMs: 60000,\n          maxRequests: 5\n        });\n        \n        expect(() => {\n          rateLimiter(req as any, mockRes as any, () => {});\n        }).not.toThrow();\n      });\n    });\n\n    it('should fallback to safe defaults on configuration errors', () => {\n      expect(() => {\n        service.createRateLimit({\n          id: 'fallback-test',\n          name: 'Fallback Test',\n          windowMs: -1, // Invalid window\n          maxRequests: -1 // Invalid max\n        });\n      }).not.toThrow();\n    });\n  });\n\n  describe('Performance and Scalability', () => {\n    it('should handle high request volumes efficiently', async () => {\n      const rateLimiter = service.createRateLimit({\n        id: 'performance-test',\n        name: 'Performance Test',\n        windowMs: 60000,\n        maxRequests: 1000\n      });\n      \n      const startTime = Date.now();\n      const promises = [];\n      \n      // Simulate high load\n      for (let i = 0; i < 100; i++) {\n        const req = MockRequest.createIPv4Request(`192.168.${Math.floor(i / 255)}.${i % 255}`);\n        promises.push(\n          new Promise<void>((resolve) => {\n            rateLimiter(req as any, mockRes as any, () => resolve());\n          })\n        );\n      }\n      \n      await Promise.all(promises);\n      const endTime = Date.now();\n      \n      // Should complete within reasonable time\n      expect(endTime - startTime).toBeLessThan(5000); // 5 seconds\n    });\n  });\n\n  describe('Production Scenarios', () => {\n    it('should handle mixed IPv4/IPv6 traffic from load balancer', async () => {\n      service.updateSecurityConfig({\n        trustProxy: true,\n        enableIPv6: true,\n        enableFingerprinting: true\n      });\n      \n      const rateLimiter = service.createRateLimit({\n        id: 'production-mixed-test',\n        name: 'Production Mixed Traffic Test',\n        windowMs: 60000,\n        maxRequests: 10\n      });\n      \n      const requests = [\n        MockRequest.createProxiedRequest('203.0.113.1'), // IPv4 via proxy\n        MockRequest.createProxiedRequest('2001:db8::1'), // IPv6 via proxy\n        MockRequest.createIPv4Request('198.51.100.1'), // Direct IPv4\n        MockRequest.createIPv6Request('2001:db8::2') // Direct IPv6\n      ];\n      \n      for (const req of requests) {\n        await new Promise<void>((resolve) => {\n          rateLimiter(req as any, mockRes as any, () => resolve());\n        });\n      }\n      \n      const metrics = service.getMetrics();\n      expect(metrics.ipv4Requests).toBeGreaterThan(0);\n      expect(metrics.ipv6Requests).toBeGreaterThan(0);\n      expect(metrics.totalRequests).toBe(4);\n    });\n  });\n});"