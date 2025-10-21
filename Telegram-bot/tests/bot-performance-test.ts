/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║          BOT REAL-TIME PERFORMANCE & STABILITY TEST                  ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║ Measures: RPS, Memory, CPU, Crash Risk                               ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 */

import 'reflect-metadata';
import { storage } from '../src/storage';
import { getConfig } from '../src/config';
import { Logger } from '../src/services/logger';
import * as os from 'os';

const logger = Logger.getInstance();
const config = getConfig();

// ═══════════════════════════════════════════════════════════════════════
//                           PERFORMANCE TEST
// ═══════════════════════════════════════════════════════════════════════

interface PerformanceSnapshot {
  timestamp: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  requestsCompleted: number;
  requestsFailed: number;
  avgResponseTime: number;
  rpsActual: number;
}

interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical';
  crashRisk: 'low' | 'medium' | 'high';
  issues: string[];
  recommendations: string[];
}

class PerformanceTester {
  private snapshots: PerformanceSnapshot[] = [];
  private startTime: number = 0;
  private requestCount: number = 0;
  private failedCount: number = 0;
  private responseTimes: number[] = [];

  async initialize(): Promise<void> {
    logger.info('🔧 Initializing bot and storage...');
    await storage.initialize();
    logger.info('✅ Storage initialized\n');
    this.startTime = Date.now();
  }

  async runPerformanceTest(): Promise<void> {
    logger.info('╔═══════════════════════════════════════════════════════════════════════╗');
    logger.info('║           BOT PERFORMANCE & STABILITY TEST                            ║');
    logger.info('╚═══════════════════════════════════════════════════════════════════════╝\n');

    const testDuration = 60000; // 60 seconds
    const requestsPerSecond = 100; // Target 100 req/s
    const intervalMs = 1000 / requestsPerSecond; // 10ms per request

    let totalRequests = 0;
    let testStartTime = Date.now();

    logger.info(`🚀 Starting test: ${requestsPerSecond} requests/second for 60 seconds\n`);
    logger.info('Time(s) | Requests | RPS | Memory | CPU% | AvgResp(ms) | Status');
    logger.info('─'.repeat(70));

    const snapshotInterval = setInterval(() => {
      const elapsed = Date.now() - this.startTime;
      const snapshot = this.captureSnapshot();
      this.snapshots.push(snapshot);

      const elapsedSeconds = (elapsed / 1000).toFixed(1);
      const status = this.getHealthStatus();

      logger.info(
        `${elapsedSeconds.padEnd(7)} | ${snapshot.requestsCompleted.toString().padEnd(8)} | ` +
        `${snapshot.rpsActual.toFixed(0).padEnd(3)} | ${(snapshot.memoryUsage.heapUsed / 1024 / 1024).toFixed(0).padEnd(6)} MB | ` +
        `${(snapshot.cpuUsage.user / 1000000).toFixed(1).padEnd(4)} | ` +
        `${snapshot.avgResponseTime.toFixed(0).padEnd(11)} | ${status.status.toUpperCase()}`
      );
    }, 5000); // Snapshot every 5 seconds

    // Send requests
    while (Date.now() - testStartTime < testDuration) {
      const batchSize = 10; // Batch requests
      const promises: Promise<void>[] = [];

      for (let i = 0; i < batchSize; i++) {
        const userId = 3000000 + totalRequests + i;
        promises.push(this.executeRequest(userId));
      }

      await Promise.all(promises);
      totalRequests += batchSize;

      // Control request rate
      const elapsedTime = Date.now() - testStartTime;
      const expectedTime = (totalRequests * intervalMs);
      if (expectedTime > elapsedTime) {
        await this.sleep(expectedTime - elapsedTime);
      }
    }

    clearInterval(snapshotInterval);
    logger.info('\n' + '─'.repeat(70));

    await this.printDetailedReport();
  }

  private async executeRequest(userId: number): Promise<void> {
    const startTime = Date.now();
    try {
      const userIdStr = userId.toString();
      const user = await storage.get<any>('users', userIdStr);

      if (!user) {
        await storage.set('users', {
          id: userIdStr,
          telegramId: userIdStr,
          username: `testuser${userId}`,
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
        }, userIdStr);
      }

      const responseTime = Date.now() - startTime;
      this.responseTimes.push(responseTime);
      this.requestCount++;
    } catch (error) {
      this.failedCount++;
    }
  }

  private captureSnapshot(): PerformanceSnapshot {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const elapsed = (Date.now() - this.startTime) / 1000;

    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b) / this.responseTimes.length
      : 0;

    const rpsActual = this.requestCount / elapsed;

    return {
      timestamp: Date.now(),
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      requestsCompleted: this.requestCount,
      requestsFailed: this.failedCount,
      avgResponseTime,
      rpsActual,
    };
  }

  private getHealthStatus(): HealthStatus {
    if (this.snapshots.length === 0) {
      return { status: 'healthy', crashRisk: 'low', issues: [], recommendations: [] };
    }

    const latest = this.snapshots[this.snapshots.length - 1];
    const issues: string[] = [];
    const recommendations: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    let crashRisk: 'low' | 'medium' | 'high' = 'low';

    // Check memory
    const heapUsedGB = latest.memoryUsage.heapUsed / 1024 / 1024 / 1024;
    if (heapUsedGB > 8) {
      issues.push(`High memory usage: ${heapUsedGB.toFixed(2)} GB`);
      status = 'critical';
      crashRisk = 'high';
      recommendations.push('Enable more aggressive garbage collection');
    } else if (heapUsedGB > 6) {
      issues.push(`Memory usage increasing: ${heapUsedGB.toFixed(2)} GB`);
      status = 'warning';
      crashRisk = 'medium';
      recommendations.push('Monitor memory trends');
    }

    // Check response time
    if (latest.avgResponseTime > 1000) {
      issues.push(`High response time: ${latest.avgResponseTime.toFixed(0)}ms`);
      status = 'warning';
      crashRisk = 'medium';
      recommendations.push('Check database performance');
    }

    // Check failure rate
    const failureRate = (this.failedCount / (this.requestCount + this.failedCount)) * 100;
    if (failureRate > 5) {
      issues.push(`High failure rate: ${failureRate.toFixed(1)}%`);
      status = 'warning';
      crashRisk = 'medium';
    }

    return { status, crashRisk, issues, recommendations };
  }

  private async printDetailedReport(): Promise<void> {
    logger.info('\n\n╔═══════════════════════════════════════════════════════════════════════╗');
    logger.info('║                    PERFORMANCE REPORT                                 ║');
    logger.info('╚═══════════════════════════════════════════════════════════════════════╝\n');

    const totalTime = (Date.now() - this.startTime) / 1000;
    const finalSnapshot = this.snapshots[this.snapshots.length - 1] || this.captureSnapshot();

    logger.info('📊 REQUEST STATISTICS:');
    logger.info(`   Total Requests:       ${this.requestCount.toLocaleString()}`);
    logger.info(`   Failed Requests:      ${this.failedCount.toLocaleString()}`);
    logger.info(`   Success Rate:         ${((this.requestCount / (this.requestCount + this.failedCount)) * 100).toFixed(2)}%`);
    logger.info(`   Average RPS:          ${(this.requestCount / totalTime).toFixed(0)} requests/second`);

    logger.info('\n⏱️  RESPONSE TIME:');
    const sortedTimes = [...this.responseTimes].sort((a, b) => a - b);
    logger.info(`   Average:              ${finalSnapshot.avgResponseTime.toFixed(0)}ms`);
    logger.info(`   Min:                  ${Math.min(...this.responseTimes).toFixed(0)}ms`);
    logger.info(`   Max:                  ${Math.max(...this.responseTimes).toFixed(0)}ms`);
    logger.info(`   P95:                  ${sortedTimes[Math.floor(sortedTimes.length * 0.95)].toFixed(0)}ms`);
    logger.info(`   P99:                  ${sortedTimes[Math.floor(sortedTimes.length * 0.99)].toFixed(0)}ms`);

    logger.info('\n💾 MEMORY USAGE:');
    const memGBMin = Math.min(...this.snapshots.map(s => s.memoryUsage.heapUsed)) / 1024 / 1024 / 1024;
    const memGBMax = Math.max(...this.snapshots.map(s => s.memoryUsage.heapUsed)) / 1024 / 1024 / 1024;
    const memGBFinal = finalSnapshot.memoryUsage.heapUsed / 1024 / 1024 / 1024;
    
    logger.info(`   Min Heap Used:        ${memGBMin.toFixed(2)} GB`);
    logger.info(`   Max Heap Used:        ${memGBMax.toFixed(2)} GB`);
    logger.info(`   Current Heap Used:    ${memGBFinal.toFixed(2)} GB`);
    logger.info(`   Heap Total:           ${(finalSnapshot.memoryUsage.heapTotal / 1024 / 1024 / 1024).toFixed(2)} GB`);

    logger.info('\n🔧 SYSTEM RESOURCES:');
    logger.info(`   CPU Cores:            ${os.cpus().length}`);
    logger.info(`   Total System RAM:     ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(0)} GB`);
    logger.info(`   Available RAM:        ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`);

    const health = this.getHealthStatus();
    logger.info('\n🎯 HEALTH STATUS:');
    logger.info(`   Status:               ${health.status.toUpperCase()}`);
    logger.info(`   Crash Risk:           ${health.crashRisk.toUpperCase()}`);

    if (health.issues.length > 0) {
      logger.info('\n⚠️  ISSUES DETECTED:');
      health.issues.forEach(issue => logger.info(`   • ${issue}`));
    }

    if (health.recommendations.length > 0) {
      logger.info('\n💡 RECOMMENDATIONS:');
      health.recommendations.forEach(rec => logger.info(`   • ${rec}`));
    }

    logger.info('\n' + '═'.repeat(70));
    logger.info('✅ TEST COMPLETED! 🎉');
    logger.info(`   Bot handled ${this.requestCount.toLocaleString()} requests in ${totalTime.toFixed(0)}s`);
    logger.info(`   Capacity: ~${(finalSnapshot.rpsActual).toFixed(0)} requests/second`);
    logger.info('═'.repeat(70) + '\n');
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════════════
//                               RUN TEST
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  const tester = new PerformanceTester();

  try {
    await tester.initialize();
    await tester.runPerformanceTest();
    process.exit(0);
  } catch (error) {
    logger.error('❌ Performance test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { PerformanceTester };
