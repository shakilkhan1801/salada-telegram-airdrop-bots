import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const successRate = new Rate('success_rate');
const captchaCompletionTime = new Trend('captcha_completion_time');
const taskSubmissionTime = new Trend('task_submission_time');
const totalFlowTime = new Trend('total_flow_time');
const errors = new Counter('total_errors');

export const options = {
  scenarios: {
    full_user_journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 20 },   // Warm up
        { duration: '3m', target: 50 },   // Ramp to 50
        { duration: '5m', target: 100 },  // Ramp to 100
        { duration: '5m', target: 100 },  // Stay at 100
        { duration: '2m', target: 0 },    // Ramp down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<1000'],
    'http_req_failed': ['rate<0.05'],
    'success_rate': ['rate>0.90'],
    'captcha_completion_time': ['p(95)<2000'],
    'task_submission_time': ['p(95)<500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const BOT_TOKEN = __ENV.BOT_TOKEN || 'your-bot-token';
const MINIAPP_URL = __ENV.MINIAPP_URL || 'http://localhost:3004';

export function setup() {
  console.log(`Testing full user flow against: ${BASE_URL}`);
  return { baseUrl: BASE_URL, botToken: BOT_TOKEN, miniappUrl: MINIAPP_URL };
}

export default function(data) {
  const flowStartTime = new Date().getTime();
  const userId = 2000000 + __VU + (__ITER * 10000);
  const username = `flow_test_${userId}`;
  
  let flowSuccess = true;
  
  // ========================================
  // STEP 1: /start command
  // ========================================
  group('1. User Registration (/start)', function() {
    const startPayload = {
      update_id: __ITER * 100000 + __VU,
      message: {
        message_id: __ITER * 100 + __VU,
        from: {
          id: userId,
          is_bot: false,
          first_name: 'Flow',
          last_name: `Test${__VU}`,
          username: username,
          language_code: 'en'
        },
        chat: { id: userId, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/start'
      }
    };
    
    const startRes = http.post(
      `${data.baseUrl}/webhook/${data.botToken}`,
      JSON.stringify(startPayload),
      { headers: { 'Content-Type': 'application/json' }, timeout: '10s' }
    );
    
    const startSuccess = check(startRes, {
      '/start status is 200': (r) => r.status === 200,
      '/start response time OK': (r) => r.timings.duration < 1000,
    });
    
    if (!startSuccess) {
      flowSuccess = false;
      errors.add(1);
    }
    
    sleep(1);
  });
  
  // ========================================
  // STEP 2: Miniapp Captcha Verification
  // ========================================
  group('2. Captcha Verification (Miniapp)', function() {
    const captchaStartTime = new Date().getTime();
    
    // Get captcha session
    const sessionRes = http.post(
      `${data.miniappUrl}/api/captcha/session`,
      JSON.stringify({
        initData: `user={"id":${userId},"username":"${username}"}`,
        deviceFingerprint: {
          screen: { width: 1920, height: 1080 },
          timezone: 'Asia/Dhaka',
          language: 'en',
          platform: 'Linux x86_64'
        }
      }),
      { headers: { 'Content-Type': 'application/json' }, timeout: '10s' }
    );
    
    const sessionSuccess = check(sessionRes, {
      'captcha session created': (r) => r.status === 200,
      'session has sessionId': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.sessionId !== undefined;
        } catch {
          return false;
        }
      },
    });
    
    if (!sessionSuccess) {
      flowSuccess = false;
      errors.add(1);
      return;
    }
    
    const sessionData = JSON.parse(sessionRes.body);
    sleep(0.5);
    
    // Complete captcha
    const completeRes = http.post(
      `${data.miniappUrl}/api/captcha/complete`,
      JSON.stringify({
        initData: `user={"id":${userId},"username":"${username}"}`,
        sessionId: sessionData.sessionId,
        success: true,
        score: 85 + Math.floor(Math.random() * 15),
        timeTaken: 3000 + Math.floor(Math.random() * 2000)
      }),
      { headers: { 'Content-Type': 'application/json' }, timeout: '10s' }
    );
    
    const completeSuccess = check(completeRes, {
      'captcha completion accepted': (r) => r.status === 200,
    });
    
    const captchaDuration = new Date().getTime() - captchaStartTime;
    captchaCompletionTime.add(captchaDuration);
    
    if (!completeSuccess) {
      flowSuccess = false;
      errors.add(1);
    }
    
    sleep(1);
  });
  
  // ========================================
  // STEP 3: View Main Menu
  // ========================================
  group('3. Main Menu Navigation', function() {
    const menuPayload = {
      update_id: __ITER * 100000 + __VU + 1,
      callback_query: {
        id: `${__ITER}_${__VU}_menu`,
        from: {
          id: userId,
          username: username,
        },
        message: {
          message_id: __ITER * 100 + __VU + 1,
          chat: { id: userId, type: 'private' },
          date: Math.floor(Date.now() / 1000),
        },
        data: 'main_menu',
      }
    };
    
    const menuRes = http.post(
      `${data.baseUrl}/webhook/${data.botToken}`,
      JSON.stringify(menuPayload),
      { headers: { 'Content-Type': 'application/json' }, timeout: '10s' }
    );
    
    check(menuRes, {
      'menu callback success': (r) => r.status === 200,
    });
    
    sleep(0.5);
  });
  
  // ========================================
  // STEP 4: Submit a Task
  // ========================================
  group('4. Task Submission', function() {
    const taskStartTime = new Date().getTime();
    
    const taskPayload = {
      update_id: __ITER * 100000 + __VU + 2,
      callback_query: {
        id: `${__ITER}_${__VU}_task`,
        from: {
          id: userId,
          username: username,
        },
        message: {
          message_id: __ITER * 100 + __VU + 2,
          chat: { id: userId, type: 'private' },
          date: Math.floor(Date.now() / 1000),
        },
        data: 'task_task_01_complete',
      }
    };
    
    const taskRes = http.post(
      `${data.baseUrl}/webhook/${data.botToken}`,
      JSON.stringify(taskPayload),
      { headers: { 'Content-Type': 'application/json' }, timeout: '10s' }
    );
    
    const taskDuration = new Date().getTime() - taskStartTime;
    taskSubmissionTime.add(taskDuration);
    
    check(taskRes, {
      'task submission success': (r) => r.status === 200,
    });
    
    sleep(1);
  });
  
  // ========================================
  // STEP 5: Check Balance
  // ========================================
  group('5. Balance Check', function() {
    const balancePayload = {
      update_id: __ITER * 100000 + __VU + 3,
      callback_query: {
        id: `${__ITER}_${__VU}_balance`,
        from: {
          id: userId,
          username: username,
        },
        message: {
          message_id: __ITER * 100 + __VU + 3,
          chat: { id: userId, type: 'private' },
          date: Math.floor(Date.now() / 1000),
        },
        data: 'points_balance',
      }
    };
    
    const balanceRes = http.post(
      `${data.baseUrl}/webhook/${data.botToken}`,
      JSON.stringify(balancePayload),
      { headers: { 'Content-Type': 'application/json' }, timeout: '10s' }
    );
    
    check(balanceRes, {
      'balance check success': (r) => r.status === 200,
    });
  });
  
  const flowDuration = new Date().getTime() - flowStartTime;
  totalFlowTime.add(flowDuration);
  successRate.add(flowSuccess);
  
  sleep(Math.random() * 5 + 2); // 2-7 seconds between iterations
}
