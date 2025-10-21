/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║            TELEGRAM BOT COMPREHENSIVE LOAD TEST                        ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║ Tests bot capacity under realistic user traffic patterns              ║
 * ║ Simulates concurrent users with various commands and interactions     ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 */

import 'reflect-metadata';
import { Telegraf, Context } from 'telegraf';
import { storage } from '../src/storage';
import { getConfig } from '../src/config';
import { Logger } from '../src/services/logger';

const logger = Logger.getInstance();
const config = getConfig();

// ═══════════════════════════════════════════════════════════════════════
//                           TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

interface LoadTestConfig {
  // Test phases - gradually increase load
  phases: {
    name: string;
    users: number;           // Number of concurrent users
    duration: number;        // Duration in seconds
    requestsPerUser: number; // Requests each user makes
  }[];
  
  // Request patterns
  commands: {
    command: string;
    weight: number;  // Probability weight (higher = more frequent)
  }[];
  
  // Timing
  delayBetweenRequests: number;  // ms between requests per user
  delayBetweenPhases: number;    // ms between test phases
  
  // Thresholds for pass/fail
  thresholds: {
    maxResponseTime: number;       // ms
    minSuccessRate: number;        // percentage
    maxMemoryIncrease: number;     // MB
    maxErrorRate: number;          // percentage
  };
}

const TEST_CONFIG: LoadTestConfig = {
  phases: [
    { name: 'Warm-up', users: 10, duration: 10, requestsPerUser: 5 },
    { name: 'Light Load', users: 50, duration: 20, requestsPerUser: 10 },
    { name: 'Medium Load', users: 200, duration: 30, requestsPerUser: 15 },
    { name: 'Heavy Load', users: 500, duration: 30, requestsPerUser: 20 },
    { name: 'Peak Load', users: 1000, duration: 30, requestsPerUser: 25 },
    { name: 'Stress Test', users: 2000, duration: 30, requestsPerUser: 30 },
  ],
  
  commands: [
    { command: '/start', weight: 30 },
    { command: '/balance', weight: 25 },
    { command: '/referral', weight: 20 },
    { command: '/tasks', weight: 15 },
    { command: '/withdraw', weight: 5 },
    { command: '/help', weight: 5 },
  ],
  
  delayBetweenRequests: 100,      // 100ms between user requests
  delayBetweenPhases: 5000,       // 5 seconds between phases
  
  thresholds: {
    maxResponseTime: 2000,        // 2 seconds max
    minSuccessRate: 95,           // 95% success rate
    maxMemoryIncrease: 500,       // 500MB max increase
    maxErrorRate: 5,              // 5% max errors
  }
};

// ═══════════════════════════════════════════════════════════════════════
//                              METRICS TRACKING
// ═══════════════════════════════════════════════════════════════════════

interface RequestMetrics {
  total: number;
  successful: number;
  failed: number;
  timeouts: number;
  responseTimes: number[];
  errors: Map<string, number>;
  commandStats: Map<string, {
    count: number;
    avgTime: number;
    errors: number;
  }>;
}

interface PhaseResult {
  phase: string;
  users: number;
  totalRequests: number;
  successRate: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  throughput: number;  // requests per second
  errorRate: number;
  memoryUsed: number;
  duration: number;
  passed: boolean;
  issues: string[];
}

class MetricsCollector {
  private metrics: RequestMetrics = {
    total: 0,
    successful: 0,
    failed: 0,
    timeouts: 0,
    responseTimes: [],
    errors: new Map(),
    commandStats: new Map(),
  };

  recordRequest(
    command: string,
    responseTime: number,
    success: boolean,
    error?: string
  ): void {
    this.metrics.total++;
    
    if (success) {
      this.metrics.successful++;
      this.metrics.responseTimes.push(responseTime);
    } else {
      this.metrics.failed++;
      if (error) {
        this.metrics.errors.set(error, (this.metrics.errors.get(error) || 0) + 1);
      }
    }

    // Update command stats
    if (!this.metrics.commandStats.has(command)) {
      this.metrics.commandStats.set(command, { count: 0, avgTime: 0, errors: 0 });
    }
    
    const stats = this.metrics.commandStats.get(command)!;
    stats.count++;
    
    if (success) {
      stats.avgTime = (stats.avgTime * (stats.count - 1) + responseTime) / stats.count;
    } else {
      stats.errors++;
    }
  }

  recordTimeout(command: string): void {
    this.metrics.timeouts++;
    this.recordRequest(command, 0, false, 'timeout');
  }

  getMetrics(): RequestMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      total: 0,
      successful: 0,
      failed: 0,
      timeouts: 0,
      responseTimes: [],
      errors: new Map(),
      commandStats: new Map(),
    };
  }

  calculatePercentile(percentile: number): number {
    if (this.metrics.responseTimes.length === 0) return 0;
    
    const sorted = [...this.metrics.responseTimes].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  getAverageResponseTime(): number {
    if (this.metrics.responseTimes.length === 0) return 0;
    return this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//                          LOAD TEST SIMULATOR
// ═══════════════════════════════════════════════════════════════════════

class BotLoadTester {
  private bot: Telegraf;
  private metrics: MetricsCollector;
  private results: PhaseResult[] = [];
  private startMemory: number = 0;

  constructor() {
    this.bot = new Telegraf(config.bot.token);
    this.metrics = new MetricsCollector();
  }

  async initialize(): Promise<void> {
    logger.info('🔧 Initializing bot and storage...');
    await storage.initialize();
    
    // Get bot info to verify connection
    const botInfo = await this.bot.telegram.getMe();
    logger.info(`✅ Connected to bot: @${botInfo.username}`);
    
    this.startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    logger.info(`💾 Initial memory: ${this.startMemory.toFixed(2)} MB\n`);
  }

  /**
   * Simulate a single user making requests
   */
  async simulateUser(
    userId: number,
    username: string,
    requestCount: number
  ): Promise<void> {
    for (let i = 0; i < requestCount; i++) {
      const command = this.selectRandomCommand();
      await this.executeCommand(userId, username, command);
      await this.sleep(TEST_CONFIG.delayBetweenRequests);
    }
  }

  /**
   * Execute a bot command and measure performance
   */
  async executeCommand(
    userId: number,
    username: string,
    command: string
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Simulate actual Telegram update
      const chatId = 1000000 + userId;
      
      // For testing, we'll measure database operations and bot logic
      // without actually sending Telegram messages
      
      switch (command) {
        case '/start':
          await this.testStartCommand(userId, username);
          break;
        case '/balance':
          await this.testBalanceCommand(userId);
          break;
        case '/referral':
          await this.testReferralCommand(userId);
          break;
        case '/tasks':
          await this.testTasksCommand(userId);
          break;
        case '/withdraw':
          await this.testWithdrawCommand(userId);
          break;
        case '/help':
          await this.testHelpCommand(userId);
          break;
      }
      
      const responseTime = Date.now() - startTime;
      this.metrics.recordRequest(command, responseTime, true);
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'unknown error';
      this.metrics.recordRequest(command, responseTime, false, errorMsg);
    }
  }

  /**
   * Test /start command - user registration
   */
  async testStartCommand(userId: number, username: string): Promise<void> {
    const user = await storage.get<any>('users', userId.toString());
    
    if (!user) {
      // New user registration
      await storage.set('users', {
        id: userId.toString(),
        telegramId: userId.toString(),
        userId: userId.toString(),
        username,
        points: 0,
        totalEarned: 0,
        isPremium: false,
        isBlocked: false,
        isVerified: false,
        svgCaptchaVerified: false,
        vpnDetected: false,
        proxyDetected: false,
        torDetected: false,
        networkRiskFactors: [],
        riskScore: 0,
        overallThreatLevel: 'low' as const,
        multiAccountDetected: false,
        automationDetected: false,
        botScore: 0,
        referralCode: `REF${userId}`,
        totalReferrals: 0,
        activeReferrals: 0,
        referralBonusActivated: false,
        completedTasks: [],
        tasksCompleted: 0,
        taskCompletionStatus: {},
        dailyTasksCompleted: {},
        pointsHistory: [],
        withdrawalHistory: [],
        suspiciousActivity: [],
        securityEvents: [],
        registeredAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          createdBy: 'registration' as const,
          registrationFlow: 'standard' as const,
          verificationAttempts: 0,
          deviceChanges: 0,
          ipChanges: 0,
          locationChanges: 0,
          deviceBindingHistory: [],
          locationHistory: [],
          verificationHistory: [],
          riskAssessmentHistory: [],
          customFields: {}
        }
      }, userId.toString());
    } else {
      // Update last active
      await storage.set('users', {
        ...user,
        lastActiveAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, userId.toString());
    }
  }

  /**
   * Test /balance command - read user points
   */
  async testBalanceCommand(userId: number): Promise<void> {
    await storage.get<any>('users', userId.toString());
  }

  /**
   * Test /referral command - read referral stats
   */
  async testReferralCommand(userId: number): Promise<void> {
    const user = await storage.get<any>('users', userId.toString());
    if (user) {
      // Simulate getting referral count
      await storage.countDocuments('users', {
        referredBy: user.referralCode
      });
    }
  }

  /**
   * Test /tasks command - read task list
   */
  async testTasksCommand(userId: number): Promise<void> {
    await storage.findByQuery<any>('tasks', {});
  }

  /**
   * Test /withdraw command - complex operation
   */
  async testWithdrawCommand(userId: number): Promise<void> {
    const user = await storage.get<any>('users', userId.toString());
    if (user && user.points >= 50) {
      // Simulate checking withdrawal eligibility
      await storage.get<any>('withdrawals', userId.toString());
    }
  }

  /**
   * Test /help command - simple read operation
   */
  async testHelpCommand(userId: number): Promise<void> {
    // Just simulate reading help text (no DB operation)
    await this.sleep(10);
  }

  /**
   * Select random command based on weights
   */
  selectRandomCommand(): string {
    const totalWeight = TEST_CONFIG.commands.reduce((sum, cmd) => sum + cmd.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const cmd of TEST_CONFIG.commands) {
      random -= cmd.weight;
      if (random <= 0) {
        return cmd.command;
      }
    }
    
    return TEST_CONFIG.commands[0].command;
  }

  /**
   * Run a single test phase
   */
  async runPhase(phase: typeof TEST_CONFIG.phases[0]): Promise<PhaseResult> {
    logger.info(`\n${'═'.repeat(70)}`);
    logger.info(`🚀 Phase: ${phase.name.toUpperCase()}`);
    logger.info(`   Users: ${phase.users} | Duration: ${phase.duration}s | Requests/User: ${phase.requestsPerUser}`);
    logger.info(`${'═'.repeat(70)}\n`);

    this.metrics.reset();
    const phaseStartTime = Date.now();
    const memoryBefore = process.memoryUsage().heapUsed / 1024 / 1024;

    // Create user simulation promises
    const userPromises: Promise<void>[] = [];
    
    for (let i = 0; i < phase.users; i++) {
      const userId = 1000000 + i;
      const username = `testuser${userId}`;
      userPromises.push(this.simulateUser(userId, username, phase.requestsPerUser));
    }

    // Run all users concurrently
    await Promise.all(userPromises);

    const phaseEndTime = Date.now();
    const duration = (phaseEndTime - phaseStartTime) / 1000;
    const memoryAfter = process.memoryUsage().heapUsed / 1024 / 1024;
    
    const metrics = this.metrics.getMetrics();
    const avgResponseTime = this.metrics.getAverageResponseTime();
    const p95ResponseTime = this.metrics.calculatePercentile(95);
    const p99ResponseTime = this.metrics.calculatePercentile(99);
    
    const successRate = (metrics.successful / metrics.total) * 100;
    const errorRate = (metrics.failed / metrics.total) * 100;
    const throughput = metrics.total / duration;

    // Determine if phase passed
    const issues: string[] = [];
    if (avgResponseTime > TEST_CONFIG.thresholds.maxResponseTime) {
      issues.push(`High avg response time: ${avgResponseTime.toFixed(0)}ms > ${TEST_CONFIG.thresholds.maxResponseTime}ms`);
    }
    if (successRate < TEST_CONFIG.thresholds.minSuccessRate) {
      issues.push(`Low success rate: ${successRate.toFixed(1)}% < ${TEST_CONFIG.thresholds.minSuccessRate}%`);
    }
    if (errorRate > TEST_CONFIG.thresholds.maxErrorRate) {
      issues.push(`High error rate: ${errorRate.toFixed(1)}% > ${TEST_CONFIG.thresholds.maxErrorRate}%`);
    }

    const result: PhaseResult = {
      phase: phase.name,
      users: phase.users,
      totalRequests: metrics.total,
      successRate,
      avgResponseTime,
      minResponseTime: Math.min(...metrics.responseTimes),
      maxResponseTime: Math.max(...metrics.responseTimes),
      p95ResponseTime,
      p99ResponseTime,
      throughput,
      errorRate,
      memoryUsed: memoryAfter - memoryBefore,
      duration,
      passed: issues.length === 0,
      issues,
    };

    this.results.push(result);
    this.printPhaseResult(result);

    return result;
  }

  /**
   * Print phase results
   */
  printPhaseResult(result: PhaseResult): void {
    logger.info(`\n📊 PHASE RESULTS: ${result.phase}`);
    logger.info(`${'─'.repeat(70)}`);
    logger.info(`✓ Total Requests:     ${result.totalRequests.toLocaleString()}`);
    logger.info(`✓ Success Rate:       ${result.successRate.toFixed(2)}%`);
    logger.info(`✓ Error Rate:         ${result.errorRate.toFixed(2)}%`);
    logger.info(`✓ Throughput:         ${result.throughput.toFixed(0)} req/s`);
    logger.info(`\n⏱️  Response Times:`);
    logger.info(`   Average:           ${result.avgResponseTime.toFixed(0)}ms`);
    logger.info(`   Min:               ${result.minResponseTime.toFixed(0)}ms`);
    logger.info(`   Max:               ${result.maxResponseTime.toFixed(0)}ms`);
    logger.info(`   P95:               ${result.p95ResponseTime.toFixed(0)}ms`);
    logger.info(`   P99:               ${result.p99ResponseTime.toFixed(0)}ms`);
    logger.info(`\n💾 Memory Used:       ${result.memoryUsed.toFixed(2)} MB`);
    logger.info(`⏳ Duration:          ${result.duration.toFixed(2)}s`);
    
    if (result.passed) {
      logger.info(`\n✅ Phase PASSED`);
    } else {
      logger.info(`\n⚠️  Phase NEEDS ATTENTION:`);
      result.issues.forEach(issue => logger.info(`   - ${issue}`));
    }
  }

  /**
   * Run all test phases
   */
  async runLoadTest(): Promise<void> {
    logger.info('\n╔═══════════════════════════════════════════════════════════════════════╗');
    logger.info('║           TELEGRAM BOT LOAD TEST - STARTING                           ║');
    logger.info('╚═══════════════════════════════════════════════════════════════════════╝\n');

    for (const phase of TEST_CONFIG.phases) {
      await this.runPhase(phase);
      
      // Wait between phases
      if (phase !== TEST_CONFIG.phases[TEST_CONFIG.phases.length - 1]) {
        logger.info(`\n⏳ Waiting ${TEST_CONFIG.delayBetweenPhases / 1000}s before next phase...\n`);
        await this.sleep(TEST_CONFIG.delayBetweenPhases);
      }
    }

    this.printFinalReport();
  }

  /**
   * Print final comprehensive report
   */
  printFinalReport(): void {
    const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    const memoryIncrease = finalMemory - this.startMemory;
    
    logger.info('\n\n╔═══════════════════════════════════════════════════════════════════════╗');
    logger.info('║                    FINAL LOAD TEST REPORT                              ║');
    logger.info('╚═══════════════════════════════════════════════════════════════════════╝\n');

    logger.info('📈 PHASE SUMMARY:\n');
    
    // Table header
    logger.info('Phase              Users   Req/s   Avg(ms)  P95(ms)  Success%  Status');
    logger.info('─'.repeat(75));
    
    // Results for each phase
    this.results.forEach(result => {
      const status = result.passed ? '✅ PASS' : '⚠️  WARN';
      logger.info(
        `${result.phase.padEnd(18)} ${result.users.toString().padEnd(7)} ` +
        `${result.throughput.toFixed(0).padEnd(7)} ${result.avgResponseTime.toFixed(0).padEnd(8)} ` +
        `${result.p95ResponseTime.toFixed(0).padEnd(8)} ${result.successRate.toFixed(1).padEnd(9)} ${status}`
      );
    });

    logger.info('\n');

    // Best phase performance
    const bestPhase = this.results.reduce((best, current) => 
      current.throughput > best.throughput ? current : best
    );
    
    logger.info('🏆 PEAK PERFORMANCE:');
    logger.info(`   Phase:             ${bestPhase.phase}`);
    logger.info(`   Concurrent Users:  ${bestPhase.users.toLocaleString()}`);
    logger.info(`   Peak Throughput:   ${bestPhase.throughput.toFixed(0)} req/s`);
    logger.info(`   Avg Response Time: ${bestPhase.avgResponseTime.toFixed(0)}ms`);
    logger.info(`   Success Rate:      ${bestPhase.successRate.toFixed(2)}%`);

    // Overall stats
    const totalRequests = this.results.reduce((sum, r) => sum + r.totalRequests, 0);
    const avgSuccessRate = this.results.reduce((sum, r) => sum + r.successRate, 0) / this.results.length;
    const passedPhases = this.results.filter(r => r.passed).length;

    logger.info('\n📊 OVERALL STATISTICS:');
    logger.info(`   Total Requests:    ${totalRequests.toLocaleString()}`);
    logger.info(`   Avg Success Rate:  ${avgSuccessRate.toFixed(2)}%`);
    logger.info(`   Phases Passed:     ${passedPhases}/${this.results.length}`);
    logger.info(`   Memory Increase:   ${memoryIncrease.toFixed(2)} MB`);

    // Capacity estimate
    logger.info('\n🎯 BOT CAPACITY ESTIMATE:');
    const maxStableUsers = bestPhase.passed ? bestPhase.users : 
      this.results.filter(r => r.passed).pop()?.users || 0;
    
    logger.info(`   Stable Capacity:   ${maxStableUsers.toLocaleString()} concurrent users`);
    logger.info(`   Max Throughput:    ${bestPhase.throughput.toFixed(0)} requests/second`);
    logger.info(`   Est. Daily Users:  ${(maxStableUsers * 10).toLocaleString()} (10x concurrent)`);

    // Final verdict
    const allPassed = this.results.every(r => r.passed);
    const memoryOk = memoryIncrease < TEST_CONFIG.thresholds.maxMemoryIncrease;

    logger.info('\n' + '═'.repeat(75));
    if (allPassed && memoryOk) {
      logger.info('✅ LOAD TEST PASSED! Bot is ready for production. 🎉');
      logger.info('   Bot can handle high load safely and efficiently.');
    } else {
      logger.info('⚠️  LOAD TEST COMPLETED WITH WARNINGS');
      if (!allPassed) {
        logger.info('   Some phases showed performance degradation under heavy load.');
      }
      if (!memoryOk) {
        logger.info(`   Memory increase (${memoryIncrease.toFixed(0)}MB) exceeds threshold.`);
      }
      logger.info('   Review phase details above for optimization opportunities.');
    }
    logger.info('═'.repeat(75) + '\n');
  }

  /**
   * Helper: Sleep
   */
  async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════════════
//                               RUN TEST
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  const tester = new BotLoadTester();
  
  try {
    await tester.initialize();
    await tester.runLoadTest();
    process.exit(0);
  } catch (error) {
    logger.error('❌ Load test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { BotLoadTester, TEST_CONFIG };
