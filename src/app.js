const { App } = require('@slack/bolt');
require('dotenv').config();

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Track user states
const userStates = new Map();

// Handle user joined event
app.event('team_join', async ({ event, client }) => {
  try {
    await client.chat.postMessage({
      channel: process.env.NOTIFICATION_CHANNEL,
      text: `🎉 Welcome <@${event.user.id}> to the workspace!`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎉 Welcome <@${event.user.id}> to the workspace!`
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error sending welcome message:', error);
  }
});

// Handle user reactivated event
app.event('user_change', async ({ event, client }) => {
  console.log('User change event received:', {
    userId: event.user.id,
    isDeleted: event.user.deleted,
    isRestricted: event.user.is_restricted,
    previousState: userStates.get(event.user.id),
    fullEvent: event
  });

  const previousState = userStates.get(event.user.id);
  const currentState = {
    deleted: event.user.deleted,
    isRestricted: event.user.is_restricted,
    timestamp: Date.now()
  };

  // Check if this is a reactivation
  // Either the user was previously deleted or we're seeing them for the first time after deactivation
  if (currentState.deleted === false && 
      (previousState?.deleted === true || 
       (event.user.is_restricted === true && !previousState))) {
    console.log('Reactivation detected for user:', event.user.id);
    try {
      await client.chat.postMessage({
        channel: process.env.NOTIFICATION_CHANNEL,
        text: `🔄 <@${event.user.id}> has reactivated their account!`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🔄 <@${event.user.id}> has reactivated their account!`
            }
          }
        ]
      });
    } catch (error) {
      console.error('Error sending reactivation message:', error);
    }
  }

  // Update the user's state
  userStates.set(event.user.id, currentState);
});

// Handle user deactivated event
app.event('user_change', async ({ event, client }) => {
  if (event.user.deleted === true) {
    try {
      await client.chat.postMessage({
        channel: process.env.NOTIFICATION_CHANNEL,
        text: `👋 <@${event.user.id}> has deactivated their account.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `👋 <@${event.user.id}> has deactivated their account.`
            }
          }
        ]
      });
    } catch (error) {
      console.error('Error sending deactivation message:', error);
    }
  }
});

// Start the app
(async () => {
  await app.start();
  console.log('⚡️ Bolt app is running!');
})(); 