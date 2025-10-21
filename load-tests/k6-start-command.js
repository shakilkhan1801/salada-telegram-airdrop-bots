import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const startCommandErrors = new Counter('start_command_errors');
const startCommandDuration = new Trend('start_command_duration');
const startCommandSuccessRate = new Rate('start_command_success_rate');

export const options = {
  scenarios: {
    // Scenario 1: Gradual ramp-up (simulating organic growth)
    gradual_rampup: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },    // Ramp up to 50 users
        { duration: '3m', target: 100 },   // Ramp up to 100 users
        { duration: '5m', target: 200 },   // Ramp up to 200 users
        { duration: '5m', target: 200 },   // Stay at 200 users
        { duration: '2m', target: 0 },     // Ramp down to 0
      ],
      gracefulRampDown: '30s',
      tags: { scenario: 'gradual' },
    },
    
    // Scenario 2: Spike test (sudden viral traffic)
    spike_test: {
      executor: 'ramping-vus',
      startTime: '20m',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 500 },  // Sudden spike to 500 users
        { duration: '1m', target: 500 },   // Hold for 1 minute
        { duration: '10s', target: 0 },    // Quick ramp down
      ],
      gracefulRampDown: '10s',
      tags: { scenario: 'spike' },
    },
    
    // Scenario 3: Stress test (find breaking point)
    stress_test: {
      executor: 'ramping-vus',
      startTime: '25m',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },   // Warm up
        { duration: '5m', target: 500 },   // Push to 500
        { duration: '5m', target: 1000 },  // Push to 1000
        { duration: '5m', target: 1500 },  // Push to 1500 (break point)
        { duration: '2m', target: 0 },     // Ramp down
      ],
      gracefulRampDown: '30s',
      tags: { scenario: 'stress' },
    },
  },
  
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],  // 95% under 500ms, 99% under 1s
    'http_req_failed': ['rate<0.05'],                   // Error rate under 5%
    'start_command_success_rate': ['rate>0.95'],        // Success rate above 95%
    'start_command_duration': ['p(95)<200'],            // 95% of /start under 200ms
  },
};

// Test configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const BOT_TOKEN = __ENV.BOT_TOKEN || 'your-bot-token';

export function setup() {
  console.log(`Starting load test against: ${BASE_URL}`);
  console.log(`Bot token: ${BOT_TOKEN.substring(0, 10)}...`);
  
  // Verify server is reachable
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status !== 200) {
    throw new Error(`Server health check failed: ${healthCheck.status}`);
  }
  
  return { baseUrl: BASE_URL, botToken: BOT_TOKEN };
}

export default function(data) {
  const userId = 1000000 + __VU + (__ITER * 10000);
  const username = `loadtest_user_${userId}`;
  
  // Simulate Telegram /start webhook
  const startPayload = {
    update_id: __ITER * 100000 + __VU,
    message: {
      message_id: __ITER * 100 + __VU,
      from: {
        id: userId,
        is_bot: false,
        first_name: `Load`,
        last_name: `Test ${__VU}`,
        username: username,
        language_code: 'en'
      },
      chat: {
        id: userId,
        first_name: `Load`,
        last_name: `Test ${__VU}`,
        username: username,
        type: 'private'
      },
      date: Math.floor(Date.now() / 1000),
      text: '/start'
    }
  };
  
  const startTime = new Date().getTime();
  
  // Send /start command via webhook
  const response = http.post(
    `${data.baseUrl}/webhook/${data.botToken}`,
    JSON.stringify(startPayload),
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s',
    }
  );
  
  const duration = new Date().getTime() - startTime;
  startCommandDuration.add(duration);
  
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
  });
  
  startCommandSuccessRate.add(success);
  
  if (!success) {
    startCommandErrors.add(1);
    console.log(`Error for user ${userId}: ${response.status} - ${response.body.substring(0, 100)}`);
  }
  
  // Simulate real user behavior - wait between actions
  sleep(Math.random() * 3 + 1); // 1-4 seconds
}

export function teardown(data) {
  console.log('Load test completed');
}

export function handleSummary(data) {
  return {
    'load-test-summary.json': JSON.stringify(data, null, 2),
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, options) {
  const { indent = '', enableColors = false } = options || {};
  
  let summary = '\n' + indent + '==== K6 Load Test Summary ====\n\n';
  
  // Overall stats
  summary += indent + `Total Requests: ${data.metrics.http_reqs?.values?.count || 0}\n`;
  summary += indent + `Request Rate: ${data.metrics.http_reqs?.values?.rate?.toFixed(2) || 0} req/s\n`;
  summary += indent + `Failed Requests: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%\n\n`;
  
  // Response times
  summary += indent + 'Response Times:\n';
  summary += indent + `  Avg: ${data.metrics.http_req_duration?.values?.avg?.toFixed(2) || 0}ms\n`;
  summary += indent + `  Min: ${data.metrics.http_req_duration?.values?.min?.toFixed(2) || 0}ms\n`;
  summary += indent + `  Max: ${data.metrics.http_req_duration?.values?.max?.toFixed(2) || 0}ms\n`;
  summary += indent + `  P95: ${data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) || 0}ms\n`;
  summary += indent + `  P99: ${data.metrics.http_req_duration?.values?.['p(99)']?.toFixed(2) || 0}ms\n\n`;
  
  // /start command specific
  if (data.metrics.start_command_duration) {
    summary += indent + '/start Command Performance:\n';
    summary += indent + `  Avg: ${data.metrics.start_command_duration?.values?.avg?.toFixed(2) || 0}ms\n`;
    summary += indent + `  P95: ${data.metrics.start_command_duration?.values?.['p(95)']?.toFixed(2) || 0}ms\n`;
    summary += indent + `  Success Rate: ${((data.metrics.start_command_success_rate?.values?.rate || 0) * 100).toFixed(2)}%\n`;
  }
  
  // VU stats
  summary += indent + `\nVirtual Users:\n`;
  summary += indent + `  Max: ${data.metrics.vus_max?.values?.max || 0}\n`;
  
  // Data transfer
  summary += indent + `\nData Transfer:\n`;
  summary += indent + `  Sent: ${((data.metrics.data_sent?.values?.count || 0) / 1024 / 1024).toFixed(2)} MB\n`;
  summary += indent + `  Received: ${((data.metrics.data_received?.values?.count || 0) / 1024 / 1024).toFixed(2)} MB\n`;
  
  // Thresholds
  summary += indent + '\nThreshold Status:\n';
  if (data.root_group?.checks) {
    data.root_group.checks.forEach(check => {
      const passed = check.passes === check.fails + check.passes;
      summary += indent + `  ${check.name}: ${passed ? '✅ PASS' : '❌ FAIL'} (${check.passes}/${check.passes + check.fails})\n`;
    });
  }
  
  summary += indent + '\n==========================\n';
  
  return summary;
}
