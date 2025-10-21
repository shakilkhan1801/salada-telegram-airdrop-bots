# Referral Welcome Bonus Configuration

## Overview
The referral system now supports configurable welcome bonuses for new users who join via referral links. This feature allows you to control whether new referred users receive a welcome bonus and how much they receive.

## Configuration

### Environment Variables

Add the following to your `.env` file:

```env
# Referral System Configuration
REFERRAL_BONUS=15                      # Points awarded to referrer for each successful referral
REFERRAL_WELCOME_BONUS=7                # Points awarded to new user who joins via referral
REFERRAL_WELCOME_BONUS_ENABLED=true     # Enable/disable welcome bonus for referred users (true/false)
```

### Configuration Options

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REFERRAL_BONUS` | Number | 15 | Points awarded to the referrer when someone uses their referral code |
| `REFERRAL_WELCOME_BONUS` | Number | 7 | Points awarded to new users who join using a referral code |
| `REFERRAL_WELCOME_BONUS_ENABLED` | Boolean | true | Toggle to enable/disable the welcome bonus feature |

## How It Works

### When Enabled (REFERRAL_WELCOME_BONUS_ENABLED=true)
- **Referrer** receives 15 points (REFERRAL_BONUS)
- **New User** receives 7 points (REFERRAL_WELCOME_BONUS)
- Both bonuses are awarded automatically when the referral is processed

### When Disabled (REFERRAL_WELCOME_BONUS_ENABLED=false)
- **Referrer** still receives 15 points (REFERRAL_BONUS)
- **New User** receives 0 points (no welcome bonus)
- Only the referrer benefits from the referral

## Testing

You can test the configuration using the provided test script:

```bash
node test-referral-config.js
```

This will display:
- Current environment variable values
- Loaded configuration values
- Test scenarios showing how points are distributed

## Implementation Details

### Files Modified

1. **`src/config/index.ts`**
   - Added `referralWelcomeBonus` and `referralWelcomeBonusEnabled` to bot configuration

2. **`src/services/referral-manager.service.ts`**
   - Updated to use configuration values for welcome bonus
   - Conditional logic to check if welcome bonus is enabled

3. **`src/bot/handlers/referral-handler.ts`**
   - Updated UI messages to reflect actual configuration values
   - Dynamic display of welcome bonus information

4. **`.env.example`**
   - Added documentation for new environment variables

## Usage Examples

### Scenario 1: Standard Configuration
```env
REFERRAL_BONUS=15
REFERRAL_WELCOME_BONUS=7
REFERRAL_WELCOME_BONUS_ENABLED=true
```
- Referrer gets: 15 points
- New user gets: 7 points

### Scenario 2: Higher Welcome Bonus
```env
REFERRAL_BONUS=10
REFERRAL_WELCOME_BONUS=10
REFERRAL_WELCOME_BONUS_ENABLED=true
```
- Referrer gets: 10 points
- New user gets: 10 points (equal incentive)

### Scenario 3: No Welcome Bonus
```env
REFERRAL_BONUS=20
REFERRAL_WELCOME_BONUS=0
REFERRAL_WELCOME_BONUS_ENABLED=false
```
- Referrer gets: 20 points
- New user gets: 0 points

## Best Practices

1. **Balanced Incentives**: Keep the welcome bonus lower than the referral bonus to incentivize sharing
2. **Testing**: Always test configuration changes in a development environment first
3. **Communication**: Update your bot's messages when changing bonus amounts
4. **Monitoring**: Track referral metrics to optimize bonus amounts

## Troubleshooting

### Welcome Bonus Not Working
1. Check that `REFERRAL_WELCOME_BONUS_ENABLED=true` in your `.env` file
2. Verify `REFERRAL_WELCOME_BONUS` has a positive value
3. Rebuild the project: `npm run build`
4. Restart the bot

### Configuration Not Loading
1. Ensure `.env` file is in the project root
2. Check for typos in variable names
3. Verify boolean values are `true` or `false` (not `1` or `0`)

## Future Enhancements

Consider implementing:
- Tiered welcome bonuses based on referrer's level
- Time-limited bonus campaigns
- Different bonuses for different user segments
- Bonus multipliers for special events