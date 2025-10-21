const { MongoClient } = require('mongodb');
require('dotenv').config();

/**
 * Setup Database Indexes for Performance Optimization
 * 
 * This script creates indexes on critical fields to improve query performance
 * from O(n) linear scans to O(log n) or O(1) lookups
 */
async function setupIndexes() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  
  if (!mongoUri) {
    console.error('❌ Error: MONGODB_URI or MONGO_URI not found in environment variables');
    process.exit(1);
  }

  console.log('🔗 Connecting to MongoDB...');
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    
    console.log('\n📊 Creating indexes for performance optimization...\n');
    
    // ============================================
    // USER COLLECTION INDEXES
    // ============================================
    console.log('Creating indexes on users collection...');
    
    try {
      await db.collection('users').createIndex(
        { telegramId: 1 }, 
        { unique: true, name: 'idx_telegramId_unique' }
      );
      console.log('  ✅ Created index: telegramId (unique)');
    } catch (e) {
      if (e.code === 85) {
        console.log('  ℹ️  Index already exists: telegramId');
      } else {
        throw e;
      }
    }
    
    try {
      await db.collection('users').createIndex(
        { referralCode: 1 }, 
        { unique: true, sparse: true, name: 'idx_referralCode_unique' }
      );
      console.log('  ✅ Created index: referralCode (unique)');
    } catch (e) {
      if (e.code === 85) {
        console.log('  ℹ️  Index already exists: referralCode');
      } else {
        throw e;
      }
    }
    
    await db.collection('users').createIndex(
      { walletAddress: 1 }, 
      { sparse: true, name: 'idx_walletAddress' }
    );
    console.log('  ✅ Created index: walletAddress');
    
    await db.collection('users').createIndex(
      { associatedFingerprintHash: 1 }, 
      { name: 'idx_associatedFingerprintHash' }
    );
    console.log('  ✅ Created index: associatedFingerprintHash');
    
    await db.collection('users').createIndex(
      { ipAddress: 1 }, 
      { name: 'idx_ipAddress' }
    );
    console.log('  ✅ Created index: ipAddress');
    
    await db.collection('users').createIndex(
      { registeredAt: -1 }, 
      { name: 'idx_registeredAt_desc' }
    );
    console.log('  ✅ Created index: registeredAt (descending)');
    
    // ============================================
    // DEVICE FINGERPRINTS COLLECTION INDEXES
    // ============================================
    console.log('\nCreating indexes on deviceFingerprints collection...');
    
    try {
      await db.collection('deviceFingerprints').createIndex(
        { hash: 1 }, 
        { unique: true, name: 'idx_hash_unique' }
      );
      console.log('  ✅ Created index: hash (unique) - PRIMARY OPTIMIZATION');
    } catch (e) {
      if (e.code === 85) {
        console.log('  ℹ️  Index already exists: hash');
      } else {
        throw e;
      }
    }
    
    await db.collection('deviceFingerprints').createIndex(
      { userId: 1 }, 
      { name: 'idx_userId' }
    );
    console.log('  ✅ Created index: userId');
    
    // CRITICAL: Canvas fingerprint index for fast similarity detection
    await db.collection('deviceFingerprints').createIndex(
      { 'components.rendering.canvasFingerprint': 1 }, 
      { name: 'idx_canvasFingerprint' }
    );
    console.log('  ✅ Created index: canvasFingerprint - KEY OPTIMIZATION');
    
    await db.collection('deviceFingerprints').createIndex(
      { 'components.hardware.screenResolution': 1 }, 
      { name: 'idx_screenResolution' }
    );
    console.log('  ✅ Created index: screenResolution');
    
    await db.collection('deviceFingerprints').createIndex(
      { 'components.rendering.webGLRenderer': 1 }, 
      { name: 'idx_webGLRenderer' }
    );
    console.log('  ✅ Created index: webGLRenderer');
    
    await db.collection('deviceFingerprints').createIndex(
      { registeredAt: -1 }, 
      { name: 'idx_registeredAt_desc' }
    );
    console.log('  ✅ Created index: registeredAt');
    
    await db.collection('deviceFingerprints').createIndex(
      { lastSeenAt: -1 }, 
      { name: 'idx_lastSeenAt_desc' }
    );
    console.log('  ✅ Created index: lastSeenAt');
    
    // Compound indexes for complex queries
    await db.collection('deviceFingerprints').createIndex(
      { 
        'components.rendering.canvasFingerprint': 1,
        userId: 1 
      }, 
      { name: 'idx_canvas_userId_compound' }
    );
    console.log('  ✅ Created compound index: canvasFingerprint + userId');
    
    await db.collection('deviceFingerprints').createIndex(
      { 
        'components.hardware.screenResolution': 1,
        'components.browser.userAgent': 1 
      }, 
      { name: 'idx_screen_userAgent_compound' }
    );
    console.log('  ✅ Created compound index: screenResolution + userAgent');
    
    // ============================================
    // SECURITY COLLECTIONS INDEXES
    // ============================================
    console.log('\nCreating indexes on security collections...');
    
    await db.collection('suspiciousActivities').createIndex(
      { userId: 1, timestamp: -1 }, 
      { name: 'idx_userId_timestamp' }
    );
    console.log('  ✅ Created index: suspiciousActivities - userId + timestamp');
    
    await db.collection('securityEvents').createIndex(
      { userId: 1, type: 1 }, 
      { name: 'idx_userId_type' }
    );
    console.log('  ✅ Created index: securityEvents - userId + type');
    
    await db.collection('securityEvents').createIndex(
      { timestamp: -1 }, 
      { name: 'idx_timestamp_desc' }
    );
    console.log('  ✅ Created index: securityEvents - timestamp');
    
    // ============================================
    // CAPTCHA SESSIONS INDEXES
    // ============================================
    console.log('\nCreating indexes on captchaSessions collection...');
    
    await db.collection('captchaSessions').createIndex(
      { sessionId: 1 }, 
      { unique: true, name: 'idx_sessionId_unique' }
    );
    console.log('  ✅ Created index: sessionId (unique)');
    
    await db.collection('captchaSessions').createIndex(
      { userId: 1, createdAt: -1 }, 
      { name: 'idx_userId_createdAt' }
    );
    console.log('  ✅ Created index: userId + createdAt');
    
    await db.collection('captchaSessions').createIndex(
      { expiresAt: 1 }, 
      { name: 'idx_expiresAt' }
    );
    console.log('  ✅ Created index: expiresAt (for cleanup)');
    
    // ============================================
    // PRINT INDEX STATISTICS
    // ============================================
    console.log('\n📊 Index Statistics:\n');
    
    const collections = ['users', 'deviceFingerprints', 'suspiciousActivities', 'securityEvents', 'captchaSessions'];
    
    for (const collectionName of collections) {
      try {
        const indexes = await db.collection(collectionName).indexes();
        console.log(`${collectionName}:`);
        console.log(`  Total indexes: ${indexes.length}`);
        indexes.forEach(idx => {
          console.log(`    - ${idx.name}: ${JSON.stringify(idx.key)}`);
        });
        console.log('');
      } catch (e) {
        console.log(`  ⚠️  Collection not found: ${collectionName}`);
      }
    }
    
    console.log('✅ All indexes created successfully!');
    console.log('\n🚀 Performance Improvement Expected:');
    console.log('   - Fingerprint lookups: 100x - 10,000x faster');
    console.log('   - User queries: 50x - 1,000x faster');
    console.log('   - Canvas matching: Near instant (< 10ms)');
    
  } catch (error) {
    console.error('❌ Error setting up indexes:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the script
if (require.main === module) {
  setupIndexes()
    .then(() => {
      console.log('\n✨ Setup complete!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { setupIndexes };
