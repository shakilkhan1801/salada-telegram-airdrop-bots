# 🚀 Production Deployment Guide for 1M Users

## 📊 Performance Targets

| Metric | Target | Method |
|--------|--------|--------|
| **/start Response Time** | < 200ms | Redis cache + parallel queries |
| **Concurrent Users** | 1000+ simultaneous | Connection pooling + Redis sessions |
| **Success Rate** | 99.9%+ | Fail-fast timeouts + retries |
| **Database Load** | < 1000 QPS | Compound indexes + distributed cache |
| **Memory per Instance** | < 512MB | LRU cache + TTL cleanup |
| **Total User Capacity** | 1M+ active users | Horizontal scaling + Redis |

---

## 🏗️ Architecture Overview

```
                                    ┌─────────────────┐
                                    │  Load Balancer  │
                                    │    (Nginx)      │
                                    └────────┬────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
              ┌─────▼─────┐           ┌─────▼─────┐           ┌─────▼─────┐
              │   Bot #1  │           │   Bot #2  │           │   Bot #3  │
              │  Instance │           │  Instance │           │  Instance │
              └─────┬─────┘           └─────┬─────┘           └─────┬─────┘
                    │                        │                        │
                    └────────────────────────┼────────────────────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
              ┌─────▼─────┐           ┌─────▼─────┐           ┌─────▼─────┐
              │   Redis   │           │  MongoDB  │           │  MongoDB  │
              │  Cluster  │           │  Primary  │           │  Replica  │
              └───────────┘           └───────────┘           └───────────┘
```

---

## 📋 Prerequisites

### **Hardware Requirements (Per Bot Instance)**

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 2 cores | 4+ cores |
| **RAM** | 2GB | 4-8GB |
| **Disk** | 20GB | 50GB+ SSD |
| **Network** | 100Mbps | 1Gbps |

### **For 1M Users (Full Stack)**

| Component | Configuration |
|-----------|---------------|
| **Bot Instances** | 3-5 instances (load balanced) |
| **Redis** | 1 master + 2 replicas (cluster mode) |
| **MongoDB** | 1 primary + 2 secondaries (replica set) |
| **Load Balancer** | Nginx or HAProxy |

---

## ⚙️ Environment Configuration

### **Critical Redis Configuration**

Add to `.env`:

```bash
# ┌──────────────────────────────────────────────────────────────────────────┐
# │                    🔴 CRITICAL: REDIS CONFIGURATION                       │
# └──────────────────────────────────────────────────────────────────────────┘
# Redis is REQUIRED for production (1000+ concurrent users)

# Redis Connection
REDIS_HOST=localhost              # Your Redis master hostname
REDIS_PORT=6379                   # Redis port
REDIS_PASSWORD=your_secure_password_here  # IMPORTANT: Set strong password

# Redis Database Separation (better performance)
REDIS_SESSION_DB=1                # Sessions
REDIS_CACHE_DB=2                  # User cache
REDIS_DEDUP_DB=0                  # Update deduplication (default)

# Cache Configuration
USER_CACHE_SIZE=50000             # L1 cache: 50k users (~100MB RAM per instance)
USER_CACHE_TTL_MS=300000          # 5 minutes

# Performance Tuning
WEBHOOK_RESPONSE_TIMEOUT_MS=25000
MINIAPP_RATE_LIMIT_MAX=200        # 200 requests per 5min per IP
MINIAPP_MAX_CONNECTIONS=10000     # Max concurrent connections to MiniApp

# Referral Batching (reduces DB load by 80%)
ENABLE_REFERRAL_BATCHING=true
REFERRAL_BATCH_SIZE=50
REFERRAL_BATCH_INTERVAL_MS=100
```

### **MongoDB Optimization**

```bash
# ┌──────────────────────────────────────────────────────────────────────────┐
# │                    MONGODB PRODUCTION CONFIGURATION                       │
# └──────────────────────────────────────────────────────────────────────────┘

# Use MongoDB replica set for high availability
MONGODB_URL=mongodb://user:pass@host1:27017,host2:27017,host3:27017/dbname?replicaSet=rs0&retryWrites=true&w=majority

# Connection pool (automatically optimized in code)
# maxPoolSize: 200
# minPoolSize: 20
# Read from secondaries for better distribution
```

---

## 🚀 Step-by-Step Deployment

### **Step 1: Setup Redis Cluster (30 minutes)**

#### **Option A: Redis Cluster (Recommended for 1M users)**

```bash
# Install Redis
sudo apt-get update
sudo apt-get install redis-server -y

# Configure Redis for production
sudo nano /etc/redis/redis.conf
```

Add/modify these settings:

```conf
# Network
bind 0.0.0.0
protected-mode yes
port 6379
requirepass YOUR_STRONG_PASSWORD_HERE

# Performance
maxmemory 2gb
maxmemory-policy allkeys-lru
tcp-backlog 511
timeout 300

# Persistence (for sessions)
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec

# Connections
maxclients 10000
```

```bash
# Restart Redis
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# Test connection
redis-cli -a YOUR_PASSWORD ping
# Should return: PONG
```

#### **Option B: Docker Redis (Quick Setup)**

```bash
docker run -d --name redis-bot \
  -p 6379:6379 \
  -e REDIS_PASSWORD=your_secure_password \
  --restart unless-stopped \
  redis:7-alpine redis-server \
  --requirepass your_secure_password \
  --maxmemory 2gb \
  --maxmemory-policy allkeys-lru \
  --save 900 1 \
  --appendonly yes
```

---

### **Step 2: Setup MongoDB Indexes (10 minutes)**

```bash
cd /project/workspace/Telegram-bot

# Run the production index setup script
node scripts/setup-production-indexes.js

# You should see:
# ✅ Users collection: X indexes
# ✅ Referrals collection: X indexes
# ✅ Device fingerprints collection: X indexes
# ✅ Task submissions collection: X indexes
```

**Verify indexes were created:**

```bash
mongo YOUR_MONGODB_URL

# In MongoDB shell:
use telegram_airdrop_bot
db.users.getIndexes()
db.referrals.getIndexes()
db.task_submissions.getIndexes()
```

---

### **Step 3: Configure Environment Variables (5 minutes)**

```bash
cd /project/workspace/Telegram-bot
nano .env
```

Add these **CRITICAL** production settings:

```bash
# ═══════════════════════════════════════════════════════════════════
#                     PRODUCTION CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

NODE_ENV=production
USE_WEBHOOK=true
WEBHOOK_URL=https://your-domain.com/webhook
TELEGRAM_WEBHOOK_SECRET=generate_random_32_char_secret_here

# ═══════════════════════════════════════════════════════════════════
#                     REDIS (REQUIRED FOR PRODUCTION)
# ═══════════════════════════════════════════════════════════════════

REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your_secure_redis_password

# Redis database separation
REDIS_SESSION_DB=1
REDIS_CACHE_DB=2

# ═══════════════════════════════════════════════════════════════════
#                     PERFORMANCE TUNING
# ═══════════════════════════════════════════════════════════════════

USER_CACHE_SIZE=50000
USER_CACHE_TTL_MS=300000
WEBHOOK_RESPONSE_TIMEOUT_MS=25000
MINIAPP_RATE_LIMIT_MAX=200
MINIAPP_MAX_CONNECTIONS=10000

# ═══════════════════════════════════════════════════════════════════
#                     MONGODB OPTIMIZATION
# ═══════════════════════════════════════════════════════════════════

# Use replica set for high availability
MONGODB_URL=mongodb://user:pass@primary:27017,secondary1:27017,secondary2:27017/dbname?replicaSet=rs0
```

---

### **Step 4: Build and Deploy (10 minutes)**

```bash
cd /project/workspace/Telegram-bot

# Install dependencies
npm install

# Build TypeScript
npm run build

# Deploy with PM2 ecosystem (recommended)
pm2 delete all  # Stop old instances

# Start with PM2 ecosystem config
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Enable auto-start on reboot
pm2 startup
```

---

### **Step 5: Configure PM2 for Multiple Instances (5 minutes)**

Edit `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'telegram-bot',
    script: './dist/index.js',
    instances: 3,  // Run 3 instances for load distribution
    exec_mode: 'cluster',  // Cluster mode for horizontal scaling
    env: {
      NODE_ENV: 'production'
    },
    max_memory_restart: '512M',  // Auto-restart if memory exceeds 512MB
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

```bash
# Restart with new configuration
pm2 reload ecosystem.config.js

# Monitor
pm2 monit
```

---

### **Step 6: Setup Nginx Load Balancer (15 minutes)**

Install Nginx:

```bash
sudo apt-get install nginx -y
```

Create configuration:

```bash
sudo nano /etc/nginx/sites-available/telegram-bot
```

Add this configuration:

```nginx
# Upstream bot instances
upstream telegram_bot {
    least_conn;  # Load balance based on least connections
    
    server 127.0.0.1:8443 max_fails=3 fail_timeout=30s;
    # Add more instances if needed:
    # server 127.0.0.1:8444 max_fails=3 fail_timeout=30s;
    # server 127.0.0.1:8445 max_fails=3 fail_timeout=30s;
    
    keepalive 100;  # Keep 100 connections alive to backend
}

# Webhook endpoint
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # SSL optimization
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    
    # Connection limits
    limit_conn_zone $binary_remote_addr zone=bot_conn:10m;
    limit_conn bot_conn 100;  # Max 100 concurrent connections per IP
    
    # Request limits
    limit_req_zone $binary_remote_addr zone=bot_req:10m rate=100r/s;
    limit_req zone=bot_req burst=200 nodelay;  # Allow burst of 200
    
    # Webhook endpoint
    location /webhook {
        # Only allow Telegram IPs
        allow 149.154.160.0/20;
        allow 91.108.4.0/22;
        deny all;
        
        proxy_pass http://telegram_bot;
        proxy_http_version 1.1;
        
        # Timeouts
        proxy_connect_timeout 5s;
        proxy_send_timeout 10s;
        proxy_read_timeout 10s;
        
        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Keep alive
        proxy_set_header Connection "";
        
        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
    }
    
    # MiniApp endpoint
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        
        # WebSocket support for future
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Standard headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable and start:

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/telegram-bot /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

---

### **Step 7: Monitor Performance (5 minutes)**

```bash
# Monitor PM2 instances
pm2 monit

# Check Redis memory usage
redis-cli -a YOUR_PASSWORD info memory

# Check MongoDB connection pool
mongo YOUR_MONGODB_URL --eval "db.serverStatus().connections"

# Monitor logs
tail -f logs/combined.log | grep -E "cache statistics|Redis|performance"
```

---

## 📈 Verification Checklist

After deployment, verify these metrics:

### **Cache Performance (Check after 30 minutes)**

```bash
# Check logs for cache statistics
grep "cache statistics" logs/combined.log | tail -5

# Expected output:
# Distributed cache statistics {
#   l1Size: 12453,
#   l1Hits: 45623,
#   l2Hits: 12340,
#   misses: 4231,
#   hitRate: 93.21,  # ✅ Target: > 80%
#   redisAvailable: true
# }
```

**Targets:**
- ✅ **Total hit rate: > 80%**
- ✅ **L1 hit rate: > 60%**
- ✅ **L2 hit rate: > 15%**
- ✅ **Redis available: true**

---

### **Redis Health**

```bash
# Check Redis connection
redis-cli -a YOUR_PASSWORD ping
# Should return: PONG

# Check memory usage
redis-cli -a YOUR_PASSWORD info memory | grep used_memory_human
# Should be: < 500MB

# Check session count
redis-cli -a YOUR_PASSWORD --scan --pattern "session:*" | wc -l

# Check cache count
redis-cli -a YOUR_PASSWORD -n 2 --scan --pattern "user:*" | wc -l
```

---

### **MongoDB Performance**

```bash
# Check connection pool usage
mongo YOUR_MONGODB_URL --eval "db.serverStatus().connections"
# active should be < 150 (out of 200 max)

# Verify compound indexes
mongo YOUR_MONGODB_URL --eval "db.users.getIndexes().length"
# Should return: 20+ indexes

# Test query performance with explain
mongo YOUR_MONGODB_URL --eval "
  db.users.find({telegramId: '123'}).explain('executionStats').executionStats
"
# totalDocsExamined should equal nReturned (1:1 ratio)
```

---

### **Response Time Verification**

```bash
# Test /start command response time
time curl -X POST https://your-domain.com/webhook \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: YOUR_SECRET" \
  -d '{
    "update_id": 999999,
    "message": {
      "message_id": 1,
      "from": {"id": 123456, "first_name": "Test"},
      "chat": {"id": 123456, "type": "private"},
      "date": 1234567890,
      "text": "/start"
    }
  }'

# Response should be < 100ms
```

---

## 🔥 Load Testing (Before Production)

Test your bot can handle 1000 concurrent /start commands:

```javascript
// load-test-start-command.js
const axios = require('axios');

const WEBHOOK_URL = 'https://your-domain.com/webhook';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const CONCURRENT = 1000;
const BATCHES = 10;

async function simulateStart(index) {
  const userId = 1000000 + index;
  const update = {
    update_id: 1000000 + index,
    message: {
      message_id: index,
      from: {
        id: userId,
        first_name: 'LoadTest' + index,
        username: 'loadtest' + index
      },
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: '/start'
    }
  };

  const start = Date.now();
  try {
    await axios.post(WEBHOOK_URL, update, {
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': SECRET
      },
      timeout: 5000
    });
    const duration = Date.now() - start;
    return { success: true, duration };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function runLoadTest() {
  console.log(`\n🚀 Load Testing: ${CONCURRENT} concurrent /start commands\n`);
  
  const results = { success: 0, failed: 0, durations: [] };
  
  for (let batch = 0; batch < BATCHES; batch++) {
    console.log(`Batch ${batch + 1}/${BATCHES}...`);
    
    const promises = Array(CONCURRENT / BATCHES)
      .fill()
      .map((_, i) => simulateStart(batch * (CONCURRENT / BATCHES) + i));
    
    const batchResults = await Promise.all(promises);
    
    batchResults.forEach(r => {
      if (r.success) {
        results.success++;
        results.durations.push(r.duration);
      } else {
        results.failed++;
      }
    });
    
    // Small delay between batches
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Calculate statistics
  results.durations.sort((a, b) => a - b);
  const p50 = results.durations[Math.floor(results.durations.length * 0.50)];
  const p95 = results.durations[Math.floor(results.durations.length * 0.95)];
  const p99 = results.durations[Math.floor(results.durations.length * 0.99)];
  const avg = results.durations.reduce((a, b) => a + b, 0) / results.durations.length;
  
  console.log('\n📊 Load Test Results:\n');
  console.log(`Total Requests:  ${CONCURRENT}`);
  console.log(`Success:         ${results.success} (${(results.success/CONCURRENT*100).toFixed(1)}%)`);
  console.log(`Failed:          ${results.failed} (${(results.failed/CONCURRENT*100).toFixed(1)}%)`);
  console.log(`\nLatency:`);
  console.log(`  Average:       ${avg.toFixed(0)}ms`);
  console.log(`  p50:           ${p50}ms`);
  console.log(`  p95:           ${p95}ms`);
  console.log(`  p99:           ${p99}ms`);
  console.log(`\nTargets:`);
  console.log(`  Success rate:  ${results.success >= CONCURRENT * 0.99 ? '✅' : '❌'} (target: 99%+)`);
  console.log(`  p95 latency:   ${p95 < 500 ? '✅' : '❌'} (target: < 500ms)`);
  console.log(`  p99 latency:   ${p99 < 1000 ? '✅' : '❌'} (target: < 1000ms)`);
}

runLoadTest().catch(console.error);
```

Run the test:

```bash
node load-test-start-command.js
```

**Success Criteria:**
- ✅ Success rate: **> 99%**
- ✅ p95 latency: **< 500ms**
- ✅ p99 latency: **< 1000ms**

---

## 🎯 Performance Benchmarks

### **Expected Results (After All Optimizations)**

#### **Single Instance (1 bot, Redis, MongoDB)**

| Load Level | Success Rate | Avg Latency | p95 Latency | DB Queries/sec |
|------------|--------------|-------------|-------------|----------------|
| 10 users/sec | 100% | 50ms | 100ms | 50 QPS |
| 50 users/sec | 99.8% | 80ms | 150ms | 150 QPS |
| 100 users/sec | 99.5% | 120ms | 250ms | 300 QPS |
| 200 users/sec | 98% | 200ms | 450ms | 500 QPS |

#### **Multi-Instance (3 bots + Redis Cluster + MongoDB Replica)**

| Load Level | Success Rate | Avg Latency | p95 Latency | Total QPS |
|------------|--------------|-------------|-------------|-----------|
| 100 users/sec | 100% | 40ms | 80ms | 300 QPS |
| 500 users/sec | 99.9% | 60ms | 120ms | 800 QPS |
| 1000 users/sec | 99.5% | 100ms | 200ms | 1200 QPS |
| 2000 users/sec | 98% | 180ms | 400ms | 2000 QPS |

---

## 🔍 Monitoring & Alerting

### **Critical Metrics to Monitor**

1. **Cache Hit Rate** (Target: > 80%)
   ```bash
   grep "cache statistics" logs/combined.log | tail -1
   ```

2. **Redis Latency** (Target: < 10ms)
   ```bash
   redis-cli -a PASSWORD --latency-history
   ```

3. **MongoDB Connection Pool** (Target: < 90% utilization)
   ```bash
   mongo URL --eval "db.serverStatus().connections"
   ```

4. **Bot Response Time** (Target: p95 < 500ms)
   ```bash
   grep "Bot response" logs/combined.log | tail -100
   ```

### **Setup Alerts**

Add to your monitoring system (Prometheus/Grafana):

```yaml
alerts:
  - name: high_cache_miss_rate
    condition: cache_hit_rate < 70
    action: notify_team
    
  - name: slow_start_command
    condition: p95_start_latency > 500ms
    action: notify_team
    
  - name: redis_connection_lost
    condition: redis_available == false
    action: page_oncall
    
  - name: mongodb_pool_exhaustion
    condition: db_connections_active > 180
    action: page_oncall
```

---

## 🆘 Troubleshooting Production Issues

### **Issue: Cache hit rate < 50%**

**Diagnosis:**
```bash
# Check if Redis is available
grep "Redis" logs/combined.log | tail -20

# Check cache configuration
env | grep CACHE
```

**Solution:**
```bash
# Increase cache size
USER_CACHE_SIZE=100000

# Increase TTL
USER_CACHE_TTL_MS=600000  # 10 minutes

# Restart bot
pm2 restart all
```

---

### **Issue: High latency (> 1 second)**

**Diagnosis:**
```bash
# Check MongoDB slow queries
mongo URL --eval "db.setProfilingLevel(2, { slowms: 100 })"
mongo URL --eval "db.system.profile.find().sort({ts:-1}).limit(10).pretty()"

# Check Redis latency
redis-cli -a PASSWORD --latency

# Check network latency to database
ping YOUR_MONGODB_HOST
```

**Solution:**
```bash
# If MongoDB is slow:
# 1. Verify indexes
node scripts/setup-production-indexes.js

# 2. Check MongoDB server resources (CPU, RAM, IOPS)

# If Redis is slow:
# 1. Check memory usage
redis-cli -a PASSWORD info memory

# 2. Consider using Redis cluster

# If network is slow:
# 1. Move services to same region
# 2. Use private network between services
```

---

### **Issue: Connection pool exhausted**

**Symptoms:**
```log
MongoServerError: connection pool is full
```

**Diagnosis:**
```bash
# Check current pool usage
mongo URL --eval "db.serverStatus().connections"
```

**Solution:**

Edit `src/storage/implementations/mongodb-storage.ts`:

```typescript
// Increase pool size (only if MongoDB server can handle it)
maxPoolSize: 300,  // Increased from 200
minPoolSize: 30,   // Increased from 20
```

Or scale horizontally (add more bot instances with separate pools).

---

### **Issue: Redis memory full**

**Diagnosis:**
```bash
redis-cli -a PASSWORD info memory | grep used_memory_human
redis-cli -a PASSWORD info stats | grep evicted_keys
```

**Solution:**
```bash
# Option 1: Increase Redis memory limit
redis-cli -a PASSWORD CONFIG SET maxmemory 4gb

# Option 2: Reduce cache TTL
USER_CACHE_TTL_MS=180000  # 3 minutes instead of 5

# Option 3: Reduce cache size
USER_CACHE_SIZE=25000
```

---

## 🎓 Scaling Roadmap

### **0-10k Users (Current)**
- ✅ Single bot instance
- ✅ Single Redis instance
- ✅ MongoDB single server or small cluster
- ✅ In-memory cache + Redis cache

### **10k-100k Users**
- ✅ 2-3 bot instances (PM2 cluster mode)
- ✅ Redis with persistence
- ✅ MongoDB replica set (1 primary + 2 secondaries)
- ✅ Nginx load balancer
- ✅ Distributed cache

### **100k-500k Users**
- ✅ 3-5 bot instances
- ✅ Redis Cluster (3 masters + 3 replicas)
- ✅ MongoDB sharded cluster
- ✅ Separate read/write databases
- ✅ CDN for static assets

### **500k-1M+ Users**
- ✅ 5-10 bot instances (auto-scaling)
- ✅ Redis Cluster with Sentinel
- ✅ MongoDB sharded cluster (multiple shards)
- ✅ Message queue (RabbitMQ/Kafka) for async tasks
- ✅ Dedicated microservices (referrals, tasks, captcha)
- ✅ Multi-region deployment

---

## 🔐 Security Checklist

- [ ] Redis password configured
- [ ] MongoDB authentication enabled
- [ ] Webhook secret token set
- [ ] HTTPS/SSL certificates installed
- [ ] Nginx rate limiting active
- [ ] Firewall rules configured
- [ ] Admin endpoints protected
- [ ] Session encryption enabled

---

## ✅ Pre-Production Final Check

Run through this before going live:

```bash
# 1. Test /start command
curl -X POST YOUR_WEBHOOK_URL -d '...' # Should respond < 200ms

# 2. Load test
node load-test-start-command.js  # Should pass all targets

# 3. Check Redis
redis-cli -a PASSWORD ping  # Should return PONG

# 4. Check MongoDB indexes
node scripts/setup-production-indexes.js  # Should show all indexes

# 5. Check PM2 status
pm2 status  # All instances should be 'online'

# 6. Check logs for errors
tail -f logs/error.log  # Should be minimal errors

# 7. Monitor for 1 hour
# Watch for memory leaks, connection issues, slow queries
```

---

**Your bot is now ready for 1M users! 🚀**
