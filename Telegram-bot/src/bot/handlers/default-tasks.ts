import { Task } from '../../types/task.types';
import { getConfig } from '../../config';

const config = getConfig();

/**
 * Default tasks that are always available in the bot
 * These tasks are permanent and will be automatically loaded on bot startup
 */
export const DEFAULT_TASKS: Record<string, Task> = {
  task_01: {
    id: 'task_01',
    title: '🎯 Join our Telegram Channel',
    description: 'Join our official Telegram channel to get the latest updates and announcements. We will verify your membership automatically.',
    category: 'tele_social',
    type: 'telegram_join',
    points: config.points.channelJoin || 10,
    icon: '📢',
    verificationMethod: 'telegram_api',
    isActive: true,
    isDaily: false,
    maxCompletions: 1,
    completionCount: 0,
    requirements: {
      verificationRequired: true
    },
    validation: {
      submissionRequired: false,
      autoApprove: true,
      reviewRequired: false
    },
    buttons: [
      {
        text: '📢 Join Channel',
        action: 'open_url',
        url: process.env.TASK_TELEGRAM_CHANNEL || 'https://t.me/yourchannel',
        style: 'primary'
      },
      {
        text: '✅ Check & Complete',
        action: 'complete',
        style: 'success'
      }
    ],
    order: 1,
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2025-12-31T23:59:59.000Z',
    createdAt: '2025-08-14T00:00:00.000Z',
    updatedAt: '2025-08-14T00:00:00.000Z',
    metadata: {
      channelId: process.env.TASK_TELEGRAM_CHANNEL_ID || '-1001234567890',
      targetUrl: process.env.TASK_TELEGRAM_CHANNEL || 'https://t.me/yourchannel',
      successMessage: `🎉 Thank you for joining our channel! You earned ${config.points.channelJoin || 10} points!`,
      failureMessage: '❌ Please join our channel first, then click Check & Complete.'
    }
  },

  task_02: {
    id: 'task_02',
    title: '🐦 Follow us on Twitter',
    description: 'Follow our Twitter profile and submit your Twitter profile link to verify the follow.',
    category: 'social',
    type: 'twitter_follow',
    points: config.points.twitterFollow || 10,
    icon: '🐦',
    verificationMethod: 'user_submission',
    isActive: true,
    isDaily: false,
    maxCompletions: 1,
    completionCount: 0,
    requirements: {
      verificationRequired: true
    },
    validation: {
      submissionRequired: true,
      submissionPattern: '^https?://(www\\.)?(twitter\\.com|x\\.com)/',
      submissionInstructions: '🔗 Submit your Twitter/X profile URL for verification\n\n📍 Your profile link: Go to your Twitter/X profile → Copy URL from browser\n\n✅ Accepted formats: twitter.com or x.com profile links',
      autoApprove: false,
      reviewRequired: true
    },
    buttons: [
      {
        text: '🐦 Follow Twitter',
        action: 'open_url',
        url: process.env.TASK_TWITTER_PROFILE || 'https://twitter.com/yourprofile',
        style: 'primary'
      },
      {
        text: '📝 Submit Profile',
        action: 'submit',
        style: 'success',
        requiresSubmission: true
      }
    ],
    order: 2,
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2025-12-31T23:59:59.000Z',
    createdAt: '2025-08-14T00:00:00.000Z',
    updatedAt: '2025-08-14T00:00:00.000Z',
    metadata: {
      twitterUsername: process.env.TASK_TWITTER_PROFILE?.split('/').pop() || 'yourprofile',
      targetUrl: process.env.TASK_TWITTER_PROFILE || 'https://twitter.com/yourprofile',
      successMessage: `🎉 Twitter follow task completed! You earned ${config.points.twitterFollow || 10} points!`,
      failureMessage: '❌ Please follow our Twitter account and submit your correct profile link.'
    }
  },

  task_03: {
    id: 'task_03',
    title: '🔄 Retweet our Tweet',
    description: 'Retweet our pinned tweet and submit the retweet link to earn points.',
    category: 'social',
    type: 'twitter_retweet',
    points: config.points.retweet || 10,
    icon: '🔄',
    verificationMethod: 'user_submission',
    isActive: true,
    isDaily: false,
    maxCompletions: 1,
    completionCount: 0,
    requirements: {
      verificationRequired: true
    },
    validation: {
      submissionRequired: true,
      submissionPattern: '^https?://(www\\.)?(twitter\\.com|x\\.com)/.*/status/',
      submissionInstructions: '🔗 Submit your retweet URL to complete verification\n\n📍 Quick Guide: Retweet → Visit your profile → Click retweet timestamp → Copy URL\n\n✅ Accepted formats: twitter.com or x.com status links',
      autoApprove: false,
      reviewRequired: true
    },
    buttons: [
      {
        text: '🔄 Retweet',
        action: 'open_url',
        url: process.env.TASK_TWITTER_TWEET || 'https://twitter.com/yourprofile/status/1234567890',
        style: 'primary'
      },
      {
        text: '📝 Submit Retweet Link',
        action: 'submit',
        style: 'success',
        requiresSubmission: true
      }
    ],
    order: 3,
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2025-12-31T23:59:59.000Z',
    createdAt: '2025-08-14T00:00:00.000Z',
    updatedAt: '2025-08-14T00:00:00.000Z',
    metadata: {
      targetUrl: process.env.TASK_TWITTER_TWEET || 'https://twitter.com/yourprofile/status/1234567890',
      successMessage: `🎉 Retweet task completed! You earned ${config.points.retweet || 10} points!`,
      failureMessage: '❌ Please retweet our post and submit the correct retweet link.'
    }
  },

  task_04: {
    id: 'task_04',
    title: '📝 Daily Check-in',
    description: 'Check in daily to earn points. Streak bonus available for consecutive days!',
    category: 'daily',
    type: 'daily_bonus',
    points: config.bot.dailyBonus || 10,
    icon: '📅',
    verificationMethod: 'time_based',
    isActive: true,
    isDaily: true,
    cooldownHours: 24,
    maxCompletions: 999,
    completionCount: 0,
    requirements: {
      verificationRequired: false
    },
    validation: {
      submissionRequired: false,
      autoApprove: true,
      reviewRequired: false
    },
    buttons: [
      {
        text: '✅ Check In Now',
        action: 'complete',
        style: 'success'
      }
    ],
    order: 4,
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2025-12-31T23:59:59.000Z',
    createdAt: '2025-08-14T00:00:00.000Z',
    updatedAt: '2025-08-14T00:00:00.000Z',
    metadata: {
      successMessage: `🎉 Daily check-in completed! You earned ${config.bot.dailyBonus || 10} points!`,
      failureMessage: '❌ You have already checked in today. Come back tomorrow!'
    }
  },

  task_05: {
    id: 'task_05',
    title: '👥 Invite 3 Friends',
    description: 'Invite 3 friends to join the bot using your referral link. We will automatically track your invites.',
    category: 'referral',
    type: 'referral_invite',
    points: config.points.perReferral || 15,
    icon: '👥',
    verificationMethod: 'referral_count',
    isActive: true,
    isDaily: false,
    maxCompletions: 1,
    completionCount: 0,
    requirements: {
      verificationRequired: true,
      minimumTasks: 3
    },
    validation: {
      submissionRequired: false,
      autoApprove: true,
      reviewRequired: false
    },
    buttons: [
      {
        text: '📤 Get Referral Link',
        action: 'open_url',
        callback: 'get_referral_link',
        style: 'primary'
      },
      {
        text: '✅ Check Progress',
        action: 'complete',
        style: 'success'
      }
    ],
    order: 5,
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2025-12-31T23:59:59.000Z',
    createdAt: '2025-08-14T00:00:00.000Z',
    updatedAt: '2025-08-14T00:00:00.000Z',
    metadata: {
      requiredReferrals: 3,
      successMessage: '🎉 Congratulations! You invited 3 friends and earned 100 points!',
      failureMessage: 'Invite 3 friends to complete this task. Tap Get Referral Link to share.'
    }
  },

  task_06: {
    id: 'task_06',
    title: '⭐ Premium Member Check',
    description: 'Get extra rewards for being a Telegram Premium member. We will automatically verify your premium status.',
    category: 'premium',
    type: 'premium_check',
    points: config.points.premiumMember || 50,
    icon: '⭐',
    verificationMethod: 'telegram_premium',
    isActive: true,
    isDaily: false,
    maxCompletions: 1,
    completionCount: 0,
    requirements: {
      verificationRequired: true,
      premiumRequired: true
    },
    validation: {
      submissionRequired: false,
      autoApprove: true,
      reviewRequired: false
    },
    buttons: [
      {
        text: '✅ Check Premium Status',
        action: 'complete',
        style: 'success'
      }
    ],
    order: 6,
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2025-12-31T23:59:59.000Z',
    createdAt: '2025-08-14T00:00:00.000Z',
    updatedAt: '2025-08-14T00:00:00.000Z',
    metadata: {
      successMessage: `🎉 Premium member verified! You earned ${config.points.premiumMember || 50} points!`,
      failureMessage: '❌ This task is only available for Telegram Premium members.'
    }
  },

  task_07: {
    id: 'task_07',
    title: '✨ Special Tweet Review with Withdrawal Proof',
    description: 'Withdraw SALA tokens, share your withdrawal screenshot on Twitter/X with a review, and submit your tweet link to earn bonus points!',
    category: 'social',
    type: 'custom',
    points: 25,
    icon: '✨',
    verificationMethod: 'user_submission',
    isActive: true,
    isDaily: false,
    maxCompletions: 1,
    completionCount: 0,
    requirements: {
      verificationRequired: true
    },
    validation: {
      submissionRequired: true,
      submissionPattern: '^https?://(www\\.)?(twitter\\.com|x\\.com)/.*/status/',
      submissionInstructions: '✨ How to Complete This Task:\n\n📝 Step 1: Withdraw SALA tokens from the bot\n📸 Step 2: Take a screenshot of your successful withdrawal\n🐦 Step 3: Post on Twitter/X with:\n   • Your withdrawal screenshot\n   • Your review about SALA Token\n   • Hashtags: #SALA #SALADA\n\n📍 Step 4: Copy your tweet URL and submit it here\n\n✅ Accepted format: twitter.com or x.com tweet/status links\n\n⚠️ Important: Your tweet MUST include withdrawal screenshot and hashtags #SALA #SALADA',
      autoApprove: false,
      reviewRequired: true
    },
    buttons: [
      {
        text: '💰 Withdraw SALA First',
        action: 'open_url',
        callback: 'show_wallet',
        style: 'primary'
      },
      {
        text: '✍️ Post Review Tweet',
        action: 'open_url',
        url: 'https://twitter.com/intent/tweet?text=Just%20withdrew%20SALA%20tokens!%20%23SALA%20%23SALADA',
        style: 'primary'
      },
      {
        text: '📝 Submit Tweet Link',
        action: 'submit',
        style: 'success',
        requiresSubmission: true
      }
    ],
    order: 7,
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2025-12-31T23:59:59.000Z',
    createdAt: '2025-08-14T00:00:00.000Z',
    updatedAt: '2025-08-14T00:00:00.000Z',
    metadata: {
      targetUrl: 'https://twitter.com/intent/tweet?text=Just%20withdrew%20SALA%20tokens!%20%23SALA%20%23SALADA',
      requiredAction: 'Withdraw SALA tokens, share withdrawal screenshot on Twitter with review and hashtags #SALA #SALADA, then submit tweet link',
      successMessage: '🎉 Special tweet review task completed! You earned 25 points!',
      failureMessage: '❌ Please withdraw SALA tokens first, post a review tweet with withdrawal screenshot and hashtags #SALA #SALADA, then submit the correct tweet link.',
      verificationInstructions: 'Admin: Verify that tweet contains withdrawal screenshot and hashtags #SALA #SALADA'
    }
  },

  task_08: {
    id: 'task_08',
    title: '📸 Follow us on Instagram',
    description: 'Follow our official Instagram profile and submit your Instagram profile link so we can verify you.',
    category: 'social',
    type: 'instagram_follow',
    points: config.points.instagramFollow || 10,
    icon: '📸',
    verificationMethod: 'user_submission',
    isActive: true,
    isDaily: false,
    maxCompletions: 1,
    completionCount: 0,
    requirements: {
      verificationRequired: true
    },
    validation: {
      submissionRequired: true,
      submissionPattern: '^https?://(www\\.)?instagram\\.com/[A-Za-z0-9._%+-]+/?$',
      submissionInstructions: '🔗 Submit your Instagram profile URL for verification\n\n📍 Go to your Instagram profile → tap the ••• menu → copy profile URL\n\n✅ Accepted format: https://www.instagram.com/username',
      autoApprove: false,
      reviewRequired: true
    },
    buttons: [
      {
        text: '📸 Open Instagram',
        action: 'open_url',
        url: process.env.TASK_INSTAGRAM_PROFILE || 'https://instagram.com/yourprofile',
        style: 'primary'
      },
      {
        text: '📝 Submit Profile',
        action: 'submit',
        style: 'success',
        requiresSubmission: true
      }
    ],
    order: 8,
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2025-12-31T23:59:59.000Z',
    createdAt: '2025-10-07T00:00:00.000Z',
    updatedAt: '2025-10-07T00:00:00.000Z',
    metadata: {
      targetUrl: process.env.TASK_INSTAGRAM_PROFILE || 'https://instagram.com/yourprofile',
      successMessage: `🎉 Instagram follow task completed! You earned ${config.points.instagramFollow || 10} points!`,
      failureMessage: '❌ Please follow our Instagram profile and submit the correct profile link.'
    }
  }
};

/**
 * Get all default tasks
 */
export function getDefaultTasks(): Record<string, Task> {
  return DEFAULT_TASKS;
}

/**
 * Get a specific default task by ID
 */
export function getDefaultTask(id: string): Task | undefined {
  return DEFAULT_TASKS[id];
}

/**
 * Get default tasks filtered by category
 */
export function getDefaultTasksByCategory(category: string): Record<string, Task> {
  const filtered: Record<string, Task> = {};
  
  Object.entries(DEFAULT_TASKS).forEach(([id, task]) => {
    if (task.category === category) {
      filtered[id] = task;
    }
  });
  
  return filtered;
}

/**
 * Get only active default tasks
 */
export function getActiveDefaultTasks(): Record<string, Task> {
  const active: Record<string, Task> = {};
  
  Object.entries(DEFAULT_TASKS).forEach(([id, task]) => {
    if (task.isActive) {
      active[id] = task;
    }
  });
  
  return active;
}

/**
 * Create a new task template based on existing task
 */
export function createTaskTemplate(sourceTaskId: string, overrides: Partial<Task> = {}): Task | null {
  const sourceTask = DEFAULT_TASKS[sourceTaskId];
  if (!sourceTask) return null;
  
  const newId = `task_${Date.now()}`;
  
  return {
    ...sourceTask,
    id: newId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completionCount: 0,
    ...overrides
  };
}