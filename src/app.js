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
      text: `🎉 <@${event.user.id}> joined Aucklandia!`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎉 <@${event.user.id}> joined Aucklandia!`
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
        text: `👋 <@${event.user.id}> has deactivated their account. Stink.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `👋 <@${event.user.id}> has deactivated their account. Stink.`
            }
          }
        ]
      });
    } catch (error) {
      console.error('Error sending deactivation message:', error);
    }
  }
});

// Error handling for the app
app.error(async (error) => {
  console.error('App error:', error);
});

// Handle WebSocket errors
app.client.on('error', async (error) => {
  console.error('WebSocket error:', error);
});

// Handle WebSocket close events
app.client.on('close', async () => {
  console.log('WebSocket connection closed. Attempting to reconnect...');
  try {
    await app.start();
    console.log('Successfully reconnected to Slack!');
  } catch (error) {
    console.error('Failed to reconnect:', error);
    // Wait 5 seconds before trying to reconnect
    setTimeout(async () => {
      try {
        await app.start();
        console.log('Successfully reconnected to Slack after retry!');
      } catch (retryError) {
        console.error('Failed to reconnect after retry:', retryError);
      }
    }, 5000);
  }
});

// Start the app
(async () => {
  try {
    await app.start();
    console.log('⚡️ Bolt app is running!');
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
})(); 