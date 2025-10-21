# Telegram Bot Dependencies Installation Guide

## Prerequisites

Before installing dependencies, make sure you have the following installed on your system:

- **Node.js** (version 16.x or higher)
- **npm** (comes with Node.js) or **yarn**
- **Git** (for version control)

## Installation Commands

### 1. Clone the Repository (if not already done)
```bash
git clone <repository-url>
cd Telegram-bot
```

### 2. Install Node.js Dependencies
```bash
npm install
```

Or if you prefer using yarn:
```bash
yarn install
```

### 3. Common Telegram Bot Dependencies
If you need to install specific packages for Telegram bot development:

```bash
# Core Telegram bot library
npm install node-telegram-bot-api

# Alternative modern Telegram bot framework
npm install telegraf

# Environment variables management
npm install dotenv

# HTTP client for API calls
npm install axios

# Database connections (choose based on your database)
npm install mongoose    # for MongoDB
npm install pg         # for PostgreSQL
npm install mysql2     # for MySQL

# Utility libraries
npm install lodash
npm install moment
```

### 4. Development Dependencies
```bash
# Development tools
npm install --save-dev nodemon
npm install --save-dev eslint
npm install --save-dev prettier

# Testing framework
npm install --save-dev jest
npm install --save-dev supertest
```

### 5. Global Dependencies (Optional)
```bash
# Install globally useful tools
npm install -g nodemon
npm install -g pm2        # for production deployment
```

## Environment Setup

1. Create a `.env` file in the project root:
```bash
copy .env.example .env
```

2. Edit the `.env` file with your bot token and other configuration:
```
BOT_TOKEN=your_telegram_bot_token_here
DATABASE_URL=your_database_connection_string
PORT=3000
```

## Running the Application

### Development Mode
```bash
npm run dev
# or
nodemon index.js
```

### Production Mode
```bash
npm start
# or
node index.js
```

## Package Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "test": "jest",
    "lint": "eslint .",
    "format": "prettier --write ."
  }
}
```

## Troubleshooting

### Common Issues

1. **Permission errors**: Run PowerShell as Administrator if needed
2. **Node version issues**: Use `node --version` to check your version
3. **npm cache issues**: Run `npm cache clean --force`
4. **Port conflicts**: Change the PORT in your `.env` file

### Clearing Dependencies
If you need to reinstall everything:
```bash
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

## Additional Resources

- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [node-telegram-bot-api Documentation](https://github.com/yagop/node-telegram-bot-api)
- [Telegraf Documentation](https://telegraf.js.org/)

---

**Note**: Make sure to never commit your `.env` file or API tokens to version control. Add `.env` to your `.gitignore` file.