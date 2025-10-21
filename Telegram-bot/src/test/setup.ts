// Test setup file
import 'reflect-metadata';
import { jest } from '@jest/globals';

// Set test environment
process.env.NODE_ENV = 'test';

// Mock console methods for cleaner test output
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Test timeout
jest.setTimeout(30000);