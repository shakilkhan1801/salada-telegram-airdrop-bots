module.exports = {
  generateStartCommand,
  generateCaptchaSession,
  generateTasksCallback,
  generateTaskComplete,
  generateBalanceCheck,
  generateReferralCheck,
  generateReferralInvite
};

let userIdCounter = 3000000;

function generateStartCommand(requestParams, context, ee, next) {
  const userId = userIdCounter++;
  const username = `artillery_${userId}`;
  
  context.vars.userId = userId;
  context.vars.username = username;
  context.vars.updateId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  
  context.vars.message = {
    message_id: Math.floor(Math.random() * 1000000),
    from: {
      id: userId,
      is_bot: false,
      first_name: 'Artillery',
      last_name: `User${userId}`,
      username: username,
      language_code: 'en'
    },
    chat: {
      id: userId,
      first_name: 'Artillery',
      last_name: `User${userId}`,
      username: username,
      type: 'private'
    },
    date: Math.floor(Date.now() / 1000),
    text: '/start'
  };
  
  return next();
}

function generateCaptchaSession(requestParams, context, ee, next) {
  const userId = context.vars.userId || 3000000;
  const username = context.vars.username || `artillery_${userId}`;
  
  context.vars.initData = `user={"id":${userId},"username":"${username}","first_name":"Artillery","last_name":"User"}`;
  context.vars.deviceFingerprint = {
    screen: {
      width: 1920,
      height: 1080,
      colorDepth: 24,
      pixelRatio: 1
    },
    hardware: {
      cores: 4,
      memory: 8,
      platform: 'Linux x86_64'
    },
    timezone: 'Asia/Dhaka',
    language: 'en-US',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
  };
  
  return next();
}

function generateTasksCallback(requestParams, context, ee, next) {
  const userId = context.vars.userId;
  
  context.vars.updateId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  context.vars.callbackQuery = {
    id: `${Date.now()}_${userId}_tasks`,
    from: {
      id: userId,
      username: context.vars.username,
    },
    message: {
      message_id: Math.floor(Math.random() * 1000000),
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
    },
    data: 'tasks_menu'
  };
  
  return next();
}

function generateTaskComplete(requestParams, context, ee, next) {
  const userId = context.vars.userId;
  
  // Random task completion
  const tasks = ['task_01', 'task_02', 'task_03', 'task_04', 'task_05'];
  const randomTask = tasks[Math.floor(Math.random() * tasks.length)];
  
  context.vars.updateId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  context.vars.callbackQuery = {
    id: `${Date.now()}_${userId}_complete`,
    from: {
      id: userId,
      username: context.vars.username,
    },
    message: {
      message_id: Math.floor(Math.random() * 1000000),
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
    },
    data: `task_${randomTask}_complete`
  };
  
  return next();
}

function generateBalanceCheck(requestParams, context, ee, next) {
  const userId = context.vars.userId || (4000000 + Math.floor(Math.random() * 100000));
  const username = context.vars.username || `artillery_${userId}`;
  
  context.vars.userId = userId;
  context.vars.username = username;
  context.vars.updateId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  
  context.vars.callbackQuery = {
    id: `${Date.now()}_${userId}_balance`,
    from: {
      id: userId,
      username: username,
    },
    message: {
      message_id: Math.floor(Math.random() * 1000000),
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
    },
    data: 'points_balance'
  };
  
  return next();
}

function generateReferralCheck(requestParams, context, ee, next) {
  const userId = context.vars.userId || (5000000 + Math.floor(Math.random() * 100000));
  const username = context.vars.username || `artillery_${userId}`;
  
  context.vars.userId = userId;
  context.vars.username = username;
  context.vars.updateId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  
  context.vars.callbackQuery = {
    id: `${Date.now()}_${userId}_referral`,
    from: {
      id: userId,
      username: username,
    },
    message: {
      message_id: Math.floor(Math.random() * 1000000),
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
    },
    data: 'referral_menu'
  };
  
  return next();
}

function generateReferralInvite(requestParams, context, ee, next) {
  const userId = context.vars.userId;
  
  context.vars.updateId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  context.vars.callbackQuery = {
    id: `${Date.now()}_${userId}_invite`,
    from: {
      id: userId,
      username: context.vars.username,
    },
    message: {
      message_id: Math.floor(Math.random() * 1000000),
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
    },
    data: 'referral_invite'
  };
  
  return next();
}
