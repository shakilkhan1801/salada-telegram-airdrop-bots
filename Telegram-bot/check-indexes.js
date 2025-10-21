require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient(process.env.MONGODB_URL);
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db(process.env.MONGODB_DATABASE || 'telegram_airdrop_bot');
    const collection = db.collection('device_fingerprints');
    
    const indexes = await collection.indexes();
    console.log('📋 Current indexes on device_fingerprints collection:\n');
    indexes.forEach((index, i) => {
      console.log(`Index ${i + 1}:`);
      console.log(`  Name: ${index.name}`);
      console.log(`  Keys: ${JSON.stringify(index.key)}`);
      if (index.unique) console.log(`  Unique: true`);
      if (index.expireAfterSeconds) console.log(`  TTL: ${index.expireAfterSeconds}s`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
})();
