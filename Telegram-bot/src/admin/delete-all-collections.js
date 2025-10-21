const { MongoClient } = require('mongodb');
const readline = require('readline');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, 'Telegram-bot', '.env') });

// MongoDB connection configuration
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://earnbuzz365:feRz3ez5opqx3aYu@62.169.16.62:27017/test?authSource=admin';
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || 'test';

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Function to ask questions
function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

async function main() {
    let client;
    
    try {
        console.log('═'.repeat(60));
        console.log('     MongoDB - Delete ALL Collections from Database');
        console.log('═'.repeat(60));
        console.log('');
        console.log(`📁 Target Database: ${MONGODB_DATABASE}`);
        console.log('');
        
        // Connect to MongoDB
        console.log('🔌 Connecting to MongoDB...');
        
        client = new MongoClient(MONGODB_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        
        await client.connect();
        console.log('✅ Connected to MongoDB successfully!\n');
        
        const db = client.db(MONGODB_DATABASE);
        
        // Get all collections
        const allCollections = await db.listCollections().toArray();
        const allCollectionNames = allCollections.map(c => c.name);
        
        if (allCollectionNames.length === 0) {
            console.log('❌ No collections found in the database!');
            return;
        }
        
        // Show all collections
        console.log(`📋 Found ${allCollectionNames.length} collections in database "${MONGODB_DATABASE}":`);
        console.log('─'.repeat(50));
        
        // Group collections by prefix for better visualization
        const grouped = {};
        let totalDocuments = 0;
        
        for (const collectionName of allCollectionNames) {
            const collection = db.collection(collectionName);
            const count = await collection.countDocuments();
            totalDocuments += count;
            
            // Determine prefix
            const parts = collectionName.split('_');
            let prefix = '(no prefix)';
            if (parts.length > 1 && collectionName.includes('_')) {
                prefix = parts[0] + '_';
            }
            
            if (!grouped[prefix]) {
                grouped[prefix] = [];
            }
            
            grouped[prefix].push({
                name: collectionName,
                count: count
            });
        }
        
        // Display grouped collections
        for (const [prefix, collections] of Object.entries(grouped)) {
            console.log(`\n🏷️  ${prefix}`);
            collections.forEach(col => {
                console.log(`   📁 ${col.name} (${col.count} documents)`);
            });
        }
        
        console.log('\n' + '─'.repeat(50));
        console.log(`📊 Total Summary:`);
        console.log(`   Collections: ${allCollectionNames.length}`);
        console.log(`   Documents: ${totalDocuments}`);
        console.log('─'.repeat(50));
        
        // Warning
        console.log(`\n⚠️  ⚠️  ⚠️  EXTREME WARNING ⚠️  ⚠️  ⚠️`);
        console.log(`This will DELETE ALL ${allCollectionNames.length} collections from database "${MONGODB_DATABASE}"!`);
        console.log(`Total of ${totalDocuments} documents will be permanently lost!`);
        console.log(`This action CANNOT be undone!\n`);
        
        // First confirmation
        const confirm1 = await askQuestion('Are you ABSOLUTELY SURE? Type "YES" to continue: ');
        
        if (confirm1 !== 'YES') {
            console.log('❌ Deletion cancelled.');
            return;
        }
        
        // Second confirmation
        console.log('\n⚠️  FINAL WARNING: This is your last chance to cancel!');
        const confirm2 = await askQuestion(`Type the database name "${MONGODB_DATABASE}" to confirm deletion: `);
        
        if (confirm2 !== MONGODB_DATABASE) {
            console.log('❌ Database name did not match. Deletion cancelled.');
            return;
        }
        
        // Final confirmation
        const confirm3 = await askQuestion('\nType "DELETE EVERYTHING" to permanently delete all collections: ');
        
        if (confirm3 !== 'DELETE EVERYTHING') {
            console.log('❌ Deletion cancelled.');
            return;
        }
        
        // Delete all collections
        console.log('\n🗑️  Deleting all collections...\n');
        
        let deletedCount = 0;
        let errorCount = 0;
        const errors = [];
        
        for (const collectionName of allCollectionNames) {
            try {
                await db.dropCollection(collectionName);
                console.log(`   ✅ Deleted: ${collectionName}`);
                deletedCount++;
            } catch (error) {
                console.log(`   ❌ Error deleting ${collectionName}: ${error.message}`);
                errors.push({ collection: collectionName, error: error.message });
                errorCount++;
            }
        }
        
        // Show final summary
        console.log('\n');
        console.log('═'.repeat(60));
        console.log('🏁 Deletion Process Complete!');
        console.log('═'.repeat(60));
        console.log(`✅ Successfully deleted: ${deletedCount} collections`);
        
        if (errorCount > 0) {
            console.log(`❌ Failed to delete: ${errorCount} collections`);
            console.log('\nFailed collections:');
            errors.forEach(err => {
                console.log(`   - ${err.collection}: ${err.error}`);
            });
        }
        
        // Verify deletion
        console.log('\n🔍 Verifying deletion...');
        const remainingCollections = await db.listCollections().toArray();
        
        if (remainingCollections.length === 0) {
            console.log(`✅ Database "${MONGODB_DATABASE}" is now completely empty!`);
            console.log('   No collections remaining.');
        } else {
            console.log(`⚠️  Warning: ${remainingCollections.length} collections still remain:`);
            remainingCollections.forEach(col => {
                console.log(`   - ${col.name}`);
            });
        }
        
        console.log('\n💡 Notes:');
        console.log(`   - Database "${MONGODB_DATABASE}" still exists but is now empty`);
        console.log('   - You can create new collections when needed');
        console.log('   - The database connection settings remain unchanged');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Full error:', error);
        
    } finally {
        if (client) {
            await client.close();
            console.log('\n🔌 MongoDB connection closed.');
        }
        rl.close();
    }
}

// Run the script
console.log('');
console.log('🚨 WARNING: This script will delete ALL collections from your database!');
console.log('');

main().catch(console.error);