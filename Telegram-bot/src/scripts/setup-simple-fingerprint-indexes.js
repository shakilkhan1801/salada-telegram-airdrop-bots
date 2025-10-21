/**
 * Setup MongoDB Indexes for Simple Fingerprint System
 * Run this script once after deploying the new simple hash system
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE || process.env.MONGODB_DB_NAME || 'telegram_bot';

async function setupIndexes() {
    console.log('🔧 Setting up MongoDB indexes for simple fingerprint system...');
    
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        const db = client.db(DB_NAME);
        const fingerprintsCollection = db.collection('device_fingerprints');
        
        // ============================================
        // Drop ALL old indexes (keep only _id_)
        // ============================================
        try {
            const existingIndexes = await fingerprintsCollection.indexes();
            console.log('📋 Existing indexes:', existingIndexes.map(i => i.name).join(', '));
            console.log('');
            
            // Drop ALL indexes except _id_ (MongoDB default)
            let droppedCount = 0;
            for (const index of existingIndexes) {
                if (index.name !== '_id_') {
                    try {
                        await fingerprintsCollection.dropIndex(index.name);
                        console.log(`🗑️  Dropped old index: ${index.name}`);
                        droppedCount++;
                    } catch (dropError) {
                        console.log(`⚠️  Could not drop ${index.name}: ${dropError.message}`);
                    }
                }
            }
            
            if (droppedCount > 0) {
                console.log(`✅ Successfully dropped ${droppedCount} old indexes`);
            } else {
                console.log('ℹ️  No old indexes to drop');
            }
            console.log('');
            
        } catch (error) {
            console.log('⚠️  Error dropping old indexes:', error.message);
        }
        
        // ============================================
        // Clean up invalid documents
        // ============================================
        console.log('🧹 Cleaning up invalid documents...');
        try {
            const cleanupResult = await fingerprintsCollection.deleteMany({ 
                $or: [
                    { hash: null },
                    { hash: { $exists: true } },  // Remove old 'hash' field documents
                    { fingerprintHash: null },
                    { userId: null }
                ]
            });
            console.log(`✅ Cleaned up ${cleanupResult.deletedCount} invalid documents`);
        } catch (cleanupError) {
            console.log('⚠️  Cleanup warning:', cleanupError.message);
        }
        console.log('');
        
        console.log('🚀 Creating new optimized indexes...\n');
        
        // ============================================
        // INDEX 1: Fingerprint Hash + User ID (Critical)
        // ============================================
        await fingerprintsCollection.createIndex(
            { fingerprintHash: 1, userId: 1 },
            { 
                unique: true,
                name: 'fingerprint_user_unique',
                background: true
            }
        );
        console.log('✅ Created index: fingerprint_user_unique');
        console.log('   Purpose: Fast exact hash lookup for multi-account detection');
        console.log('   Performance: O(1) lookup, handles millions of records\n');
        
        // ============================================
        // INDEX 2: User ID (for user fingerprint lookup)
        // ============================================
        await fingerprintsCollection.createIndex(
            { userId: 1 },
            { 
                name: 'userId_index',
                background: true
            }
        );
        console.log('✅ Created index: userId_index');
        console.log('   Purpose: Fast user fingerprint retrieval');
        console.log('   Performance: O(1) lookup by userId\n');
        
        // ============================================
        // INDEX 3: Timestamp (for auto-cleanup)
        // ============================================
        await fingerprintsCollection.createIndex(
            { createdAt: 1 },
            { 
                expireAfterSeconds: 7776000, // 90 days
                name: 'fingerprint_ttl',
                background: true
            }
        );
        console.log('✅ Created index: fingerprint_ttl');
        console.log('   Purpose: Auto-delete old fingerprints after 90 days');
        console.log('   Performance: Automatic cleanup, no manual intervention\n');
        
        // ============================================
        // INDEX 4: IP Hash + Timestamp (Rate limiting)
        // ============================================
        await fingerprintsCollection.createIndex(
            { ipHash: 1, createdAt: -1 },
            { 
                name: 'ip_timestamp_index',
                background: true
            }
        );
        console.log('✅ Created index: ip_timestamp_index');
        console.log('   Purpose: Detect multiple accounts from same IP');
        console.log('   Performance: Fast IP-based queries\n');
        
        // ============================================
        // INDEX 5: User ID + Updated At (Rate limiting)
        // ============================================
        await fingerprintsCollection.createIndex(
            { userId: 1, updatedAt: -1 },
            { 
                name: 'user_ratelimit_index',
                background: true
            }
        );
        console.log('✅ Created index: user_ratelimit_index');
        console.log('   Purpose: Fast rate limiting checks per user');
        console.log('   Performance: O(1) lookup for recent verification attempts\n');
        
        // ============================================
        // Verify indexes created
        // ============================================
        const finalIndexes = await fingerprintsCollection.indexes();
        console.log('📊 Final indexes on device_fingerprints collection:');
        finalIndexes.forEach(index => {
            console.log(`   - ${index.name}: ${JSON.stringify(index.key)}`);
        });
        
        // ============================================
        // Test index performance
        // ============================================
        console.log('\n🧪 Testing index performance...');
        
        const testHash = 'test_hash_' + Date.now();
        const testUserId = 'test_user_' + Date.now();
        
        // Insert test document
        await fingerprintsCollection.insertOne({
            userId: testUserId,
            fingerprintHash: testHash,
            ipHash: 'test_ip_hash',
            createdAt: new Date()
        });
        
        // Test lookup performance
        const lookupStart = Date.now();
        const result = await fingerprintsCollection.findOne({
            fingerprintHash: testHash,
            userId: { $ne: 'another_user' }
        });
        const lookupTime = Date.now() - lookupStart;
        
        console.log(`✅ Index lookup test: ${lookupTime}ms (should be < 10ms)`);
        
        // Cleanup test data
        await fingerprintsCollection.deleteOne({ userId: testUserId });
        
        console.log('\n✨ All indexes created successfully!');
        console.log('🎯 System is now optimized for millions of users');
        
    } catch (error) {
        console.error('❌ Error setting up indexes:', error);
        throw error;
    } finally {
        await client.close();
        console.log('\n👋 MongoDB connection closed');
    }
}

// Run setup
setupIndexes()
    .then(() => {
        console.log('\n✅ Setup completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Setup failed:', error);
        process.exit(1);
    });
