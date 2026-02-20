const { App } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Log with ISO timestamp so Dockge/logs show when things happened
const ts = () => new Date().toISOString();
const log = (...args) => console.log(ts(), ...args);
const logError = (...args) => console.error(ts(), ...args);

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
    logError('Error loading user states:', err);
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
    logError('Error saving user states:', err);
  }
}

// Track user states (loaded from disk on startup)
const userStates = loadUserStates();

// Ensure data directory exists at startup (so it's there even before first save, and works with Docker volume mount)
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  log('Created data directory:', DATA_DIR);
}

// Handle user joined workspace (team_join = workspace join, not channel join)
app.event('team_join', async ({ event, client }) => {
  const channel = process.env.NOTIFICATION_CHANNEL;
  if (!channel) {
    logError('NOTIFICATION_CHANNEL is not set; cannot post join message');
    return;
  }
  try {
    await client.chat.postMessage({
      channel,
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
    log('Posted join message for', event.user.id, 'to channel', channel);
  } catch (error) {
    logError('Error sending welcome message to', channel, ':', error.message, error);
  }
});

// Handle user_change: reactivations and deactivations (state persisted so we detect reactivations after app restarts)
app.event('user_change', async ({ event, client }) => {
  const previousState = userStates.get(event.user.id);
  // Normalise to booleans; if Slack omits deleted/is_restricted, keep previous state so we don't overwrite
  const deleted = event.user.deleted === true ? true : event.user.deleted === false ? false : (previousState?.deleted ?? false);
  const isRestricted = event.user.is_restricted === true;

  log('User change:', { userId: event.user.id, deleted, isRestricted, previousDeleted: previousState?.deleted });

  const currentState = {
    deleted,
    isRestricted,
    timestamp: Date.now()
  };

  // Reactivation: user is now active and we had them as deleted (from memory or persisted state)
  if (currentState.deleted === false && previousState?.deleted === true) {
    log('Reactivation detected for user:', event.user.id);
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
      logError('Error sending reactivation message:', error);
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
      logError('Error sending deactivation message:', error);
    }
  }

  // Update and persist state so we still detect reactivations after app restarts
  userStates.set(event.user.id, currentState);
  saveUserStates(userStates);
});

// Error handling for the app
app.error(async (error) => {
  logError('App error:', error);
});

// Handle WebSocket errors
app.client.on('error', async (error) => {
  logError('WebSocket error:', error);
});

// Handle WebSocket close events
app.client.on('close', async () => {
  log('WebSocket connection closed. Attempting to reconnect...');
  try {
    await app.start();
    log('Successfully reconnected to Slack!');
  } catch (error) {
    logError('Failed to reconnect:', error);
    // Wait 5 seconds before trying to reconnect
    setTimeout(async () => {
      try {
        await app.start();
        log('Successfully reconnected to Slack after retry!');
      } catch (retryError) {
        logError('Failed to reconnect after retry:', retryError);
      }
    }, 5000);
  }
});

// Socket-mode can throw "Unhandled event 'server explicit disconnect' in state 'connecting'" when
// Slack disconnects during connection; we log and exit so the container restarts cleanly.
process.on('uncaughtException', (err) => {
  logError('Uncaught exception (process will exit):', err.message || err);
  process.exit(1);
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
      log('Seeded', totalSeeded, 'deactivated user(s) from Slack');
    }
  } catch (err) {
    logError('Error seeding deleted users from Slack:', err);
  }
}

// Start the app
(async () => {
  try {
    await app.start();
    log('⚡️ Bolt app is running!');
    await seedDeletedUsersFromSlack();
  } catch (error) {
    logError('Failed to start app:', error);
    process.exit(1);
  }
})(); 