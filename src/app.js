const { App } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Persisted user state path (survives restarts so we detect reactivations of "old" members)
const DATA_DIR = path.join(process.cwd(), 'data');
const USER_STATES_PATH = path.join(DATA_DIR, 'user-states.json');

function loadUserStates() {
  try {
    if (fs.existsSync(USER_STATES_PATH)) {
      const raw = fs.readFileSync(USER_STATES_PATH, 'utf8');
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    }
  } catch (err) {
    console.error('Error loading user states:', err);
  }
  return new Map();
}

function saveUserStates(map) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const obj = Object.fromEntries(map);
    fs.writeFileSync(USER_STATES_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving user states:', err);
  }
}

// Track user states (loaded from disk on startup)
const userStates = loadUserStates();

// Ensure data directory exists at startup (so it's there even before first save, and works with Docker volume mount)
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('Created data directory:', DATA_DIR);
}

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

// Handle user_change: reactivations and deactivations (state persisted so we detect reactivations after app restarts)
app.event('user_change', async ({ event, client }) => {
  console.log('User change event received:', {
    userId: event.user.id,
    isDeleted: event.user.deleted,
    isRestricted: event.user.is_restricted,
    previousState: userStates.get(event.user.id)
  });

  const previousState = userStates.get(event.user.id);
  const currentState = {
    deleted: event.user.deleted,
    isRestricted: event.user.is_restricted,
    timestamp: Date.now()
  };

  // Reactivation: user is now active and we had them as deleted (from memory or persisted state)
  if (currentState.deleted === false && previousState?.deleted === true) {
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

  // Deactivation: user is now deleted
  if (currentState.deleted === true) {
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

  // Update and persist state so we still detect reactivations after app restarts
  userStates.set(event.user.id, currentState);
  saveUserStates(userStates);
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

// Seed user state from Slack on startup so we detect reactivations of members who were deactivated before the app ran
async function seedDeletedUsersFromSlack() {
  try {
    let cursor;
    let totalSeeded = 0;
    do {
      const result = await app.client.users.list({ limit: 200, cursor });
      for (const user of result.members || []) {
        if (!user.id) continue;
        if (user.deleted !== true) continue;
        const existing = userStates.get(user.id);
        if (existing?.deleted === true) continue;
        userStates.set(user.id, {
          deleted: true,
          isRestricted: user.is_restricted === true,
          timestamp: Date.now()
        });
        totalSeeded++;
      }
      cursor = result.response_metadata?.next_cursor || '';
    } while (cursor);
    if (totalSeeded > 0) {
      saveUserStates(userStates);
      console.log('Seeded', totalSeeded, 'deactivated user(s) from Slack');
    }
  } catch (err) {
    console.error('Error seeding deleted users from Slack:', err);
  }
}

// Start the app
(async () => {
  try {
    await app.start();
    console.log('⚡️ Bolt app is running!');
    await seedDeletedUsersFromSlack();
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
})(); 