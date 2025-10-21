/**
 * Load Test for Bot Response Monitoring System
 * 
 * This script simulates thousands of concurrent bot users to test
 * if the monitoring system can handle high load without crashing the bot.
 */

import { botResponseMonitor } from '../src/services/bot-response-monitor.service';

// Test Configuration
const TEST_CONFIG = {
  TOTAL_USERS: 5000, // Simulate 5000 concurrent users
  REQUESTS_PER_USER: 10, // Each user sends 10 commands
  CONCURRENT_BATCHES: 100, // Process 100 users at a time
  DELAY_BETWEEN_BATCHES: 100, // 100ms delay between batches
  COMMANDS: ['/start', '/help', '/buy', '/sell', '/balance', '/stats', '/profile'],
  ACTIONS: ['command', 'button_click', 'callback', 'inline_query'],
};

// Performance Metrics
interface TestMetrics {
  totalRequests: number;
  successfulTracks: number;
  failedTracks: number;
  startTime: number;
  endTime: number;
  peakMemoryUsage: number;
  averageTrackTime: number;
  minTrackTime: number;
  maxTrackTime: number;
}

const metrics: TestMetrics = {
  totalRequests: 0,
  successfulTracks: 0,
  failedTracks: 0,
  startTime: 0,
  endTime: 0,
  peakMemoryUsage: 0,
  averageTrackTime: 0,
  minTrackTime: Infinity,
  maxTrackTime: 0,
};

const trackTimes: number[] = [];

/**
 * Simulate a single bot command from a user
 */
async function simulateUserCommand(userId: number): Promise<void> {
  const command = TEST_CONFIG.COMMANDS[Math.floor(Math.random() * TEST_CONFIG.COMMANDS.length)];
  const action = TEST_CONFIG.ACTIONS[Math.floor(Math.random() * TEST_CONFIG.ACTIONS.length)];
  const responseTime = Math.floor(Math.random() * 1000) + 50; // 50-1050ms
  const success = Math.random() > 0.05; // 95% success rate

  const trackStart = Date.now();
  
  try {
    // This is the critical call - should be non-blocking and fast
    botResponseMonitor.trackResponse({
      command,
      action,
      responseTime,
      userId: `user_${userId}`,
      username: `testuser${userId}`,
      success,
      error: success ? undefined : 'Simulated error',
    });
    
    const trackEnd = Date.now();
    const trackTime = trackEnd - trackStart;
    
    trackTimes.push(trackTime);
    metrics.successfulTracks++;
    metrics.minTrackTime = Math.min(metrics.minTrackTime, trackTime);
    metrics.maxTrackTime = Math.max(metrics.maxTrackTime, trackTime);
  } catch (error) {
    metrics.failedTracks++;
    console.error(`Failed to track: ${error}`);
  }
  
  metrics.totalRequests++;
}

/**
 * Simulate a user sending multiple commands
 */
async function simulateUser(userId: number): Promise<void> {
  for (let i = 0; i < TEST_CONFIG.REQUESTS_PER_USER; i++) {
    await simulateUserCommand(userId);
    // Small random delay between commands
    await sleep(Math.random() * 50);
  }
}

/**
 * Run load test
 */
async function runLoadTest(): Promise<void> {
  console.log('🚀 Starting Bot Monitoring Load Test\n');
  console.log('Configuration:');
  console.log(`  - Total Users: ${TEST_CONFIG.TOTAL_USERS}`);
  console.log(`  - Requests per User: ${TEST_CONFIG.REQUESTS_PER_USER}`);
  console.log(`  - Total Requests: ${TEST_CONFIG.TOTAL_USERS * TEST_CONFIG.REQUESTS_PER_USER}`);
  console.log(`  - Concurrent Batches: ${TEST_CONFIG.CONCURRENT_BATCHES}`);
  console.log('\n⏳ Initializing monitoring system...\n');

  // Initialize monitoring
  await botResponseMonitor.initialize();
  
  console.log('✓ Monitoring initialized\n');
  console.log('🔥 Starting load test...\n');
  
  metrics.startTime = Date.now();
  const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;

  // Run users in batches to simulate concurrent load
  const totalBatches = Math.ceil(TEST_CONFIG.TOTAL_USERS / TEST_CONFIG.CONCURRENT_BATCHES);
  
  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * TEST_CONFIG.CONCURRENT_BATCHES;
    const batchEnd = Math.min(batchStart + TEST_CONFIG.CONCURRENT_BATCHES, TEST_CONFIG.TOTAL_USERS);
    
    const userPromises: Promise<void>[] = [];
    
    for (let userId = batchStart; userId < batchEnd; userId++) {
      userPromises.push(simulateUser(userId));
    }
    
    // Wait for batch to complete
    await Promise.all(userPromises);
    
    // Track memory usage
    const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    metrics.peakMemoryUsage = Math.max(metrics.peakMemoryUsage, currentMemory);
    
    // Progress report
    const progress = ((batch + 1) / totalBatches * 100).toFixed(1);
    const health = botResponseMonitor.getHealthStatus();
    process.stdout.write(
      `\r📊 Progress: ${progress}% | ` +
      `Requests: ${metrics.totalRequests} | ` +
      `Queue: ${health.queueSize} | ` +
      `Memory: ${currentMemory.toFixed(1)}MB | ` +
      `Dropped: ${health.droppedCount}`
    );
    
    // Small delay between batches
    await sleep(TEST_CONFIG.DELAY_BETWEEN_BATCHES);
  }
  
  metrics.endTime = Date.now();
  
  console.log('\n\n⏳ Waiting for queue to process...\n');
  
  // Wait for queue to drain
  await waitForQueueToDrain();
  
  console.log('✓ Queue processed\n');
  
  // Calculate final metrics
  const duration = (metrics.endTime - metrics.startTime) / 1000;
  const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
  metrics.averageTrackTime = trackTimes.reduce((a, b) => a + b, 0) / trackTimes.length;
  
  // Print results
  printResults(duration, initialMemory, finalMemory);
  
  // Get final monitoring statistics
  await printMonitoringStats();
}

/**
 * Wait for monitoring queue to drain
 */
async function waitForQueueToDrain(): Promise<void> {
  let lastQueueSize = -1;
  let stableCount = 0;
  
  while (true) {
    const health = botResponseMonitor.getHealthStatus();
    
    if (health.queueSize === 0 && lastQueueSize === 0) {
      stableCount++;
      if (stableCount >= 3) break; // Queue stable at 0 for 3 checks
    } else {
      stableCount = 0;
    }
    
    if (health.queueSize !== lastQueueSize) {
      process.stdout.write(`\r⏳ Queue size: ${health.queueSize}      `);
      lastQueueSize = health.queueSize;
    }
    
    await sleep(1000);
  }
  console.log('\r✓ Queue drained                    ');
}

/**
 * Print test results
 */
function printResults(duration: number, initialMemory: number, finalMemory: number): void {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 LOAD TEST RESULTS');
  console.log('═══════════════════════════════════════════════════\n');
  
  console.log('📈 Request Metrics:');
  console.log(`  ✓ Total Requests:      ${metrics.totalRequests.toLocaleString()}`);
  console.log(`  ✓ Successful Tracks:   ${metrics.successfulTracks.toLocaleString()}`);
  console.log(`  ✗ Failed Tracks:       ${metrics.failedTracks.toLocaleString()}`);
  console.log(`  📊 Success Rate:       ${((metrics.successfulTracks / metrics.totalRequests) * 100).toFixed(2)}%`);
  
  console.log('\n⚡ Performance Metrics:');
  console.log(`  ⏱️  Total Duration:     ${duration.toFixed(2)}s`);
  console.log(`  🚀 Throughput:         ${(metrics.totalRequests / duration).toFixed(0)} req/s`);
  console.log(`  ⚡ Avg Track Time:     ${metrics.averageTrackTime.toFixed(3)}ms`);
  console.log(`  🏃 Min Track Time:     ${metrics.minTrackTime.toFixed(3)}ms`);
  console.log(`  🐌 Max Track Time:     ${metrics.maxTrackTime.toFixed(3)}ms`);
  
  console.log('\n💾 Memory Metrics:');
  console.log(`  📊 Initial Memory:     ${initialMemory.toFixed(2)} MB`);
  console.log(`  📊 Final Memory:       ${finalMemory.toFixed(2)} MB`);
  console.log(`  📊 Peak Memory:        ${metrics.peakMemoryUsage.toFixed(2)} MB`);
  console.log(`  📊 Memory Increase:    ${(finalMemory - initialMemory).toFixed(2)} MB`);
  
  const health = botResponseMonitor.getHealthStatus();
  console.log('\n🏥 System Health:');
  console.log(`  ✓ Enabled:             ${health.enabled}`);
  console.log(`  ✓ Initialized:         ${health.initialized}`);
  console.log(`  ⚠️  Circuit Breaker:    ${health.circuitBreakerOpen ? '🔴 OPEN' : '🟢 CLOSED'}`);
  console.log(`  📉 Dropped Count:      ${health.droppedCount.toLocaleString()}`);
  console.log(`  ⚠️  Failure Count:      ${health.failureCount}`);
  console.log(`  🎯 Sampling Rate:      ${(health.samplingRate * 100).toFixed(0)}%`);
  
  console.log('\n═══════════════════════════════════════════════════');
  
  // Verdict
  const isPassing = 
    metrics.failedTracks === 0 &&
    !health.circuitBreakerOpen &&
    metrics.averageTrackTime < 5 && // Should be < 5ms
    (finalMemory - initialMemory) < 100; // Should not leak > 100MB
  
  if (isPassing) {
    console.log('\n✅ LOAD TEST PASSED! 🎉');
    console.log('   The monitoring system can handle high load safely!');
  } else {
    console.log('\n⚠️  LOAD TEST NEEDS ATTENTION!');
    if (metrics.failedTracks > 0) console.log('   - Some tracking calls failed');
    if (health.circuitBreakerOpen) console.log('   - Circuit breaker opened');
    if (metrics.averageTrackTime >= 5) console.log('   - Average track time too high');
    if ((finalMemory - initialMemory) >= 100) console.log('   - Potential memory leak detected');
  }
  
  console.log('═══════════════════════════════════════════════════\n');
}

/**
 * Print monitoring statistics
 */
async function printMonitoringStats(): Promise<void> {
  try {
    const stats = await botResponseMonitor.getStatistics();
    
    console.log('📊 Monitoring Statistics:');
    console.log(`  📝 Live Logs Count:    ${stats.liveLogsCount.toLocaleString()}`);
    console.log(`  📋 Records Count:      ${stats.recordsCount.toLocaleString()}`);
    console.log(`  ⏱️  Avg Response Time:  ${stats.averageResponseTime}ms`);
    
    if (stats.slowestCommand) {
      console.log(`  🐌 Slowest Command:    ${stats.slowestCommand.command} (${stats.slowestCommand.maxResponseTime}ms)`);
    }
    if (stats.fastestCommand) {
      console.log(`  🏃 Fastest Command:    ${stats.fastestCommand.command} (${stats.fastestCommand.avgResponseTime}ms)`);
    }
    
    console.log('');
  } catch (error) {
    console.log(`⚠️  Could not fetch monitoring stats: ${error}\n`);
  }
}

/**
 * Helper: Sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run the test
 */
if (require.main === module) {
  runLoadTest()
    .then(() => {
      console.log('✓ Load test completed\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Load test failed:', error);
      process.exit(1);
    });
}

export { runLoadTest, TEST_CONFIG };
