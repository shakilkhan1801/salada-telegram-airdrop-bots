# Simple User Data Export Scheduler Documentation

## Overview
The new simplified user data export scheduler replaces the complex cron-based job scheduling system with a straightforward interval-based approach that's easier to configure and understand.

## Features

### 1. Flexible Interval Configuration
The scheduler supports multiple time formats in the `USER_DATA_EXPORT_INTERVAL` environment variable:

- **Minutes**: `1m`, `5m`, `30m`, `45m`
- **Hours**: `1h`, `2h`, `6h`, `12h`, `24h`
- **Exact Time**: `14:30` (runs daily at 2:30 PM), `09:00` (runs daily at 9:00 AM)

### 2. Smart Timing
- **Minute intervals**: Exports happen at the start of each new minute
- **Hour intervals**: Exports happen at the start of each new hour
- **Exact time**: Exports happen once daily at the specified time

### 3. Simple Configuration
Just three environment variables control everything:

```env
# Enable/disable the export feature
ENABLE_USER_DATA_EXPORT=true

# Set the interval (examples below)
USER_DATA_EXPORT_INTERVAL=1m     # Every minute
USER_DATA_EXPORT_INTERVAL=1h     # Every hour  
USER_DATA_EXPORT_INTERVAL=14:30  # Daily at 2:30 PM

# Run export immediately on startup
USER_DATA_EXPORT_RUN_ON_START=true
```

## How It Works

1. **On Bot Startup**: 
   - The scheduler checks if exports are enabled
   - If `USER_DATA_EXPORT_RUN_ON_START=true`, it runs an immediate export
   - Sets up the interval based on your configuration

2. **During Operation**:
   - For minute/hour intervals: Waits until the next clean boundary (e.g., :00 seconds for minutes)
   - For exact times: Checks every 30 seconds if it's time to run
   - Automatically handles the export and sends CSV to admin via Telegram

3. **Export Process**:
   - Collects all user data from the database
   - Generates a CSV file with comprehensive user information
   - Sends statistics summary and CSV file to admin via Telegram
   - Cleans up temporary files

## Admin Requirements

Make sure these are set in your `.env` file:
```env
ADMIN_CHAT_ID=your_telegram_id
TELEGRAM_BOT_TOKEN=your_bot_token
```

## Testing

You can test the scheduler using the provided test script:

```bash
node test-simple-export-scheduler.js
```

This will:
- Show current configuration
- Start the scheduler
- Allow manual trigger by pressing Enter
- Show next scheduled run time

## Migration from Old System

The old system used:
- Complex cron expressions
- Job queues and worker threads
- Multiple configuration files

The new system:
- Uses simple interval strings
- Direct scheduling with Node.js timers
- Single service file with clear logic

## Troubleshooting

### Export not working?
1. Check `ENABLE_USER_DATA_EXPORT=true`
2. Verify `ADMIN_CHAT_ID` is set correctly
3. Ensure `TELEGRAM_BOT_TOKEN` is valid
4. Check logs for error messages

### Wrong timing?
1. Verify `USER_DATA_EXPORT_INTERVAL` format
2. For exact times, use 24-hour format (HH:MM)
3. Check server timezone if using exact times

### Not receiving in Telegram?
1. Ensure the admin has started a chat with the bot
2. Verify the admin chat ID is correct
3. Check if the bot token has permission to send messages

## Benefits Over Old System

1. **Simplicity**: One service file instead of multiple interconnected services
2. **Clarity**: Clear interval formats anyone can understand  
3. **Reliability**: Fewer moving parts means fewer points of failure
4. **Flexibility**: Easy to change intervals without understanding cron syntax
5. **Maintainability**: Simple code that's easy to debug and modify

## Example Configurations

### For Testing (Every Minute)
```env
USER_DATA_EXPORT_INTERVAL=1m
USER_DATA_EXPORT_RUN_ON_START=true
```

### For Production (Every 6 Hours)
```env
USER_DATA_EXPORT_INTERVAL=6h
USER_DATA_EXPORT_RUN_ON_START=false
```

### For Daily Reports (9 AM)
```env
USER_DATA_EXPORT_INTERVAL=09:00
USER_DATA_EXPORT_RUN_ON_START=false
```

## API Methods

The SimpleUserExportScheduler provides these methods:

- `start()`: Start the scheduler
- `stop()`: Stop the scheduler
- `forceExport()`: Manually trigger an export
- `getStatus()`: Get current scheduler status
- `getInstance()`: Get the singleton instance

## Implementation Details

The scheduler is implemented as a singleton service that:
1. Parses the interval configuration
2. Calculates the next run time
3. Uses `setTimeout` for initial delay to boundary
4. Uses `setInterval` for recurring exports
5. Calls the existing `UserDataExportService` for actual export

This design ensures compatibility with existing code while providing a much simpler scheduling mechanism.