# Admin Tools - ব্যবহারের নির্দেশনা 📚

## 📁 এই ফোল্ডারে কি কি আছে

1. **`server.ts`** - Admin panel server file
2. **`delete-all-collections.js`** - MongoDB database এর সব collections মুছে ফেলার জন্য script

---

## 🔧 Dependencies Install করার নিয়ম

### প্রথম ধাপ: Root Directory তে যান
```bash
cd E:\Telegram-bot114.3
```

### দ্বিতীয় ধাপ: Dependencies Install করুন
```bash
npm install mongodb dotenv
```

অথবা যদি আগে থেকেই package.json থাকে:
```bash
npm install
```

### প্রয়োজনীয় Packages:
- `mongodb` - MongoDB database এর সাথে connection এর জন্য
- `dotenv` - Environment variables (.env file) পড়ার জন্য

---

## 🚀 Scripts চালানোর নিয়ম

### 1. Delete All Collections Script

এই script টি MongoDB এর `test` database থেকে সব collections মুছে ফেলে।

#### চালানোর Command:
```bash
# Root directory থেকে
node Telegram-bot/src/admin/delete-all-collections.js

# অথবা সরাসরি
node E:\Telegram-bot114.3\Telegram-bot\src\admin\delete-all-collections.js
```

#### ⚠️ সতর্কতা:
- এই script **সব collections এবং data** permanently মুছে ফেলবে
- একবার মুছে ফেললে আর ফিরে পাওয়া যাবে না
- Script চালানোর আগে ৩ বার confirmation চাইবে:
  1. প্রথমে `YES` টাইপ করতে হবে
  2. তারপর database এর নাম `test` টাইপ করতে হবে
  3. শেষে `DELETE EVERYTHING` টাইপ করতে হবে

#### Script এর কাজ:
1. MongoDB তে connect করে
2. সব collections list করে দেখায়
3. কতগুলো documents আছে count করে দেখায়
4. User এর permission নিয়ে সব কিছু delete করে
5. Verification করে যে সব delete হয়েছে কিনা

### 2. Admin Server চালানো

```bash
# TypeScript compile করুন প্রথমে
npx tsc Telegram-bot/src/admin/server.ts

# তারপর run করুন
node Telegram-bot/src/admin/server.js
```

---

## 📋 Environment Variables (.env)

`.env` file টি `Telegram-bot` folder এ থাকতে হবে এবং নিচের variables গুলো থাকতে হবে:

```env
# MongoDB Configuration
MONGODB_URL=mongodb://username:password@host:port/database?authSource=admin
MONGODB_HOST=62.169.16.62
MONGODB_PORT=27017
MONGODB_DATABASE=test
MONGODB_USERNAME=your_username
MONGODB_PASSWORD=your_password
```

---

## 🔍 Troubleshooting

### Problem 1: MongoDB connection failed
**সমাধান:** 
- MongoDB server চালু আছে কিনা check করুন
- Username/Password ঠিক আছে কিনা দেখুন
- Network connection ঠিক আছে কিনা check করুন

### Problem 2: Module not found error
**সমাধান:**
```bash
npm install mongodb dotenv
```

### Problem 3: .env file not found
**সমাধান:** 
- `.env` file টি `E:\Telegram-bot114.3\Telegram-bot\` folder এ আছে কিনা check করুন
- File এর permissions ঠিক আছে কিনা দেখুন

---

## 📝 Notes

- সবসময় production database এ script চালানোর আগে backup নিন
- Test environment এ প্রথমে test করে নিন
- Database operations এর log রাখুন

---

## 💡 Tips

1. **Backup নেওয়ার জন্য:**
   ```bash
   mongodump --uri="mongodb://username:password@host:port/database"
   ```

2. **Specific collection delete করতে:**
   - Script modify করে specific collection target করা যায়

3. **Dry run করতে:**
   - প্রথমে শুধু list করে দেখুন, delete করবেন না

---

## 🆘 Help

কোন সমস্যা হলে:
1. Error message পুরোটা পড়ুন
2. MongoDB connection string check করুন
3. Dependencies properly installed কিনা verify করুন

---

**⚡ শেষ Update:** ৩০ সেপ্টেম্বর, ২০২৫