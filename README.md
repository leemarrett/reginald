# Reginald, aka Slack User Activity Notifier

This Slack app sends notifications to a specified channel whenever a user joins, reactivates, or deactivates their account.

## Setup Instructions

1. Create a new Slack app at https://api.slack.com/apps
2. Enable Socket Mode in your app settings
3. Add the following bot token scopes:
   - `chat:write`
   - `users:read`
4. Subscribe to the following bot events:
   - `team_join`
   - `user_change`
5. Install the app to your workspace
6. Create a `.env` file in the root directory with the following variables:
   ```
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_SIGNING_SECRET=your-signing-secret
   SLACK_APP_TOKEN=xapp-your-app-token
   NOTIFICATION_CHANNEL=your-channel-id
   ```
7. Install dependencies:
   ```bash
   npm install
   ```
8. Start the app:
   ```bash
   npm start
   ```

## Features

- Sends welcome messages when new users join
- Notifies when users reactivate their accounts
- Notifies when users deactivate their accounts

## Message Format

- New User: "🎉 Welcome @username to the workspace!"
- Reactivation: "🔄 @username has reactivated their account!"
- Deactivation: "👋 @username has deactivated their account." 