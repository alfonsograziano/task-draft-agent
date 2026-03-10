# Setup Guide: Implement Task Pipeline

This guide walks you through every step needed to get the pipeline running — from creating the Slack app to configuring Jira webhooks to starting the server.

## Table of Contents

- [Prerequisites](#prerequisites)
- [1. Clone and Install](#1-clone-and-install)
- [2. Create the Slack App](#2-create-the-slack-app)
- [3. Configure Jira](#3-configure-jira)
- [4. Configure Team Members](#4-configure-team-members)
- [5. Set Up Environment Variables](#5-set-up-environment-variables)
- [6. Start the Services](#6-start-the-services)
- [7. Expose the Server (Tunneling / Deployment)](#7-expose-the-server)
- [8. Connect Jira Webhook](#8-connect-jira-webhook)
- [9. Connect Slack Events](#9-connect-slack-events)
- [10. Verify End-to-End](#10-verify-end-to-end)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js** 22+ (required for `node:sqlite` and native TypeScript execution)
- **npm** 10+
- **OpenCode** installed and available on your PATH (`opencode serve`)
- **Git** and **GitHub CLI** (`gh`) installed on the machine where OpenCode runs
- A **Jira Cloud** instance with admin access
- A **Slack workspace** where you can create apps
- An **Anthropic API key** (or other LLM provider key for OpenCode)

---

## 1. Clone and Install

```bash
git clone <this-repo-url>
cd a-v2
npm install
```

Verify the install succeeds with no errors.

---

## 2. Create the Slack App

### 2.1 Create the App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name it something like `Task Implementer`
4. Select your workspace
5. Click **Create App**

### 2.2 Configure Bot Token Scopes

1. In the left sidebar, go to **OAuth & Permissions**
2. Scroll to **Scopes** > **Bot Token Scopes**
3. Add the following scopes:

| Scope | Why |
|-------|-----|
| `chat:write` | Send messages to channels and DMs |
| `channels:read` | View basic channel info (needed for channel lookups) |
| `channels:history` | Read messages in public channels (for thread replies) |
| `groups:history` | Read messages in private channels (if your channel is private) |
| `im:write` | Open DM conversations with team members |
| `im:history` | Read DM thread replies |
| `users:read` | Resolve user names when forwarding replies to the agent |
| `channels:join` | Allow the bot to join public channels (needed to post in the task channel) |

### 2.3 Install to Workspace

1. Still on **OAuth & Permissions**, scroll up and click **Install to Workspace**
2. Review the permissions and click **Allow**
3. Copy the **Bot User OAuth Token** — it starts with `xoxb-`

   > **Important:** If you add or change scopes later, you must **reinstall the app** to the workspace for the new scopes to take effect. Slack will show a banner at the top of the OAuth page prompting you to reinstall.

   > Save this. It goes into your `.env` as `SLACK_BOT_TOKEN`.

### 2.4 Get the Signing Secret

1. In the left sidebar, go to **Basic Information**
2. Under **App Credentials**, find **Signing Secret**
3. Click **Show** and copy it

   > Save this. It goes into your `.env` as `SLACK_SIGNING_SECRET`.

### 2.5 Create the Task Channel

1. In Slack, create a new channel (e.g., `#task-implementations`)
2. Invite the bot to the channel: type `/invite @Task Implementer` in the channel
3. Get the channel ID:
   - Right-click the channel name > **View channel details**
   - At the bottom of the details pane, you'll see the Channel ID (starts with `C`)
   - Or: click the channel name in the header > scroll to the bottom of the popup

   > Save this. It goes into your `.env` as `SLACK_CHANNEL`.

### 2.6 Enable Event Subscriptions (do this later)

You'll come back to configure event subscriptions in [Step 9](#9-connect-slack-events) after the server is running and accessible via a public URL.

---

## 3. Configure Jira

### 3.1 Create a Structured Issue Template (Recommended)

For best results, set up a structured issue template so the AI agent gets consistent, well-formatted input. The agent parses the description looking for markdown headings:

```
## Description
Detailed description of what needs to be implemented.

## Acceptance Criteria
1. The feature should...
2. Tests should cover...

## Environment
prod / staging / dev

## Additional Context
Any relevant logs, links, or references.
```

### 3.2 Set Up the Workflow

The pipeline expects a status that triggers the investigation. By default this is **"Ready for Investigation"** (configurable via `JIRA_TRIGGER_STATUS`).

Example workflow:

```
Open > Ready for Investigation > Under AI Investigation > Fix Proposed > In Review > Done
```

To create or modify a workflow:

1. Go to **Project settings** > **Workflows**
2. Edit the workflow for your issue type
3. Add the statuses above as steps
4. Add transitions between them

The management server will automatically transition issues from the trigger status to "Under AI Investigation" when it starts working.

### 3.3 Create a Jira API Token

The server uses the Jira REST API to transition issues. You need an API token:

1. Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a label like `Task Implementer Bot`
4. Copy the token

   > Save this. It goes into your `.env` as `JIRA_API_TOKEN`.

Also note down:
- The **email address** of the Atlassian account that owns this token > `JIRA_USER_EMAIL`
- Your Jira instance URL (e.g., `https://yourcompany.atlassian.net`) > `JIRA_BASE_URL`

### 3.4 Webhook Secret

Pick a random string to use as a webhook secret. This is used to validate that incoming webhooks actually come from Jira.

   > Save this. It goes into your `.env` as `JIRA_WEBHOOK_SECRET`.

You'll configure the actual webhook in [Step 8](#8-connect-jira-webhook) after the server is running.

---

## 4. Configure Team Members

Edit `config/team-members.json`. This file tells the agent who is on the team, what they work on, and how to reach them.

```json
[
  {
    "name": "Alice Chen",
    "role": "backend engineer",
    "slack_user_id": "U04A1B2C3D4",
    "areas": ["payments", "auth", "api"]
  },
  {
    "name": "Bob Martinez",
    "role": "frontend lead",
    "slack_user_id": "U04E5F6G7H8",
    "areas": ["dashboard", "ui-components", "react"]
  }
]
```

### How to find a user's Slack ID

1. In Slack, click on the person's name/avatar to open their profile
2. Click the **three dots** (More) menu
3. Click **Copy member ID**

The ID looks like `U04A1B2C3D4`.

### Field reference

| Field | Description |
|-------|-------------|
| `name` | Display name (shown in Slack messages from the agent) |
| `role` | Their role on the team (helps the agent decide who to contact) |
| `slack_user_id` | Their Slack member ID (the agent uses this to DM them) |
| `areas` | Code areas or domains they own. The agent cross-references this with the task context to find the right person to contact |

### Tips

- **Be specific with areas.** Instead of just `"backend"`, list the actual modules: `["payments", "auth", "user-service"]`. The agent matches these against file paths and module names.
- **Include relevant stakeholders.** If PMs or QA engineers create issues, include them so the agent can DM them for clarification.
- **Keep it updated.** The file is re-read on every request, so you can edit it without restarting the server.

---

## 5. Set Up Environment Variables

Copy the example file and fill in the values:

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
# Management Server
PORT=3000
OPENCODE_URL=http://localhost:4096

# Slack (from Step 2)
SLACK_BOT_TOKEN=xoxb-your-actual-token
SLACK_SIGNING_SECRET=your-actual-signing-secret
SLACK_CHANNEL=C04YOUR_CHANNEL_ID

# Jira (from Step 3)
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_API_TOKEN=your-actual-jira-api-token
JIRA_USER_EMAIL=you@yourcompany.com
JIRA_WEBHOOK_SECRET=your-webhook-secret
```

To generate random strings:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Full variable reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Port the management server listens on |
| `HOST` | No | `0.0.0.0` | Host to bind to |
| `LOG_LEVEL` | No | `info` | Server log level (`debug`, `info`, `warn`, `error`) |
| `OPENCODE_URL` | No | `http://localhost:4096` | URL of the OpenCode server |
| `SLACK_BOT_TOKEN` | Yes | — | Bot User OAuth Token from your Slack app (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Yes | — | Signing Secret from your Slack app's Basic Information page |
| `SLACK_CHANNEL` | Yes | — | Channel ID where task threads are posted |
| `JIRA_BASE_URL` | Yes | — | Your Jira Cloud instance URL |
| `JIRA_API_TOKEN` | Yes | — | Jira API token for the bot account |
| `JIRA_USER_EMAIL` | Yes | — | Email of the Atlassian account that owns the API token |
| `JIRA_WEBHOOK_SECRET` | No | — | Secret used to validate inbound Jira webhooks |
| `JIRA_TRIGGER_STATUS` | No | `ready for investigation` | Jira status that triggers the pipeline |
| `DB_PATH` | No | `data/routing.db` | Path to the SQLite database file |

---

## 6. Start the Services

You need two processes running: the management server and OpenCode.

### Terminal 1: Management Server

```bash
npm start
```

You should see:

```
[db] SQLite database initialized
[server] Management server running on http://0.0.0.0:3000
[server] Endpoints:
  POST /webhooks/jira      — Jira webhook receiver
  GET  /api/team-members   — Team members list
  POST /api/contact        — Send Slack message
  POST /slack/events       — Slack event receiver
  GET  /health             — Health check
```

Verify health:

```bash
curl http://localhost:3000/health
```

Verify team members:

```bash
curl http://localhost:3000/api/team-members
```

You can also browse the Swagger UI at [http://localhost:3000/docs](http://localhost:3000/docs).

### Terminal 2: OpenCode Server

```bash
cd /path/to/target-repo
opencode serve
```

OpenCode starts on port 4096 by default. Make sure the `OPENCODE_URL` in your `.env` matches.

---

## 7. Expose the Server

Jira and Slack need to reach your management server over the internet. You have two options:

### Option A: Tunneling (for development / testing)

Use a tunneling service to expose your local port:

```bash
# ngrok
ngrok http 3000

# cloudflared
cloudflared tunnel --url http://localhost:3000
```

Note the public URL (e.g., `https://abc123.ngrok-free.app`). You'll use this for both Jira and Slack configuration.

### Option B: Deploy to a server (for production)

Deploy the management server to a VM, container, or cloud service. Put a reverse proxy (nginx, Caddy) in front of port 3000 with TLS. Never expose the OpenCode port (4096) to the internet.

---

## 8. Connect Jira Webhook

Now that your server is reachable, create the Jira webhook:

1. In Jira, go to **Settings** (gear icon) > **System** > **WebHooks**
   - Direct URL: `https://yourcompany.atlassian.net/plugins/servlet/webhooks`

2. Click **Create a WebHook**

3. Fill in:
   - **Name:** `Task Implementer`
   - **URL:** `https://your-public-url.com/webhooks/jira`
   - **Secret:** paste the same value you used for `JIRA_WEBHOOK_SECRET` in your `.env`

4. Under **Events**, check:
   - **Issue:** `updated`

5. Optionally add a **JQL Filter** to limit which issues trigger the webhook:
   ```
   project = MYPROJECT AND status changed to "Ready for Investigation"
   ```
   (Replace `MYPROJECT` with your actual project key.)

6. Click **Create**

### Verify

1. Create a test issue in Jira
2. Transition it to "Ready for Investigation"
3. Check the management server logs — you should see the session being created
4. Check the Slack channel — a new thread should appear

---

## 9. Connect Slack Events

### 9.1 Enable Event Subscriptions

1. Go to your Slack app at [https://api.slack.com/apps](https://api.slack.com/apps)
2. In the left sidebar, click **Event Subscriptions**
3. Toggle **Enable Events** to **On**
4. Set the **Request URL** to:
   ```
   https://your-public-url.com/slack/events
   ```
5. Slack will send a challenge request. If your server is running, it will respond automatically and you'll see a green checkmark saying **Verified**.

### 9.2 Subscribe to Bot Events

Still on the Event Subscriptions page, expand **Subscribe to bot events** and add:

| Event | Why |
|-------|-----|
| `message.channels` | Detect replies in the task channel threads |
| `message.im` | Detect replies in DM threads with team members |

### 9.3 Save and Reinstall

1. Click **Save Changes**
2. Slack may prompt you to **reinstall the app** to apply the new event subscriptions. If so, click the banner and reinstall.

### Verify

1. Go to your task channel
2. Find a thread started by the bot (from Step 8's verification)
3. Reply in the thread: "This is a test reply"
4. Check the management server logs — you should see the thread reply being processed

---

## 10. Verify End-to-End

Run through the complete flow:

1. **Create an issue in Jira** with a clear task description

2. **Transition to "Ready for Investigation"**

3. **Watch the pipeline:**
   - Management server log: session created, prompt sent
   - Slack channel: new thread appears with task status
   - OpenCode: agent starts working on the task

4. **Test human communication:**
   - Wait for the agent to post a question (or test by having the agent send a `blocker` message)
   - Reply in the Slack thread
   - Verify the session resumes

5. **Check the output:**
   - The agent should create a branch, implement the changes, and open a draft PR
   - The Slack thread should have a final summary with the PR link

---

## Running Tests

```bash
npm test
```

Uses the Node.js built-in test runner.

---

## Troubleshooting

### "Missing signature" on Jira webhooks

- Make sure the `JIRA_WEBHOOK_SECRET` in your `.env` matches exactly what you entered in the Jira webhook configuration.
- If you don't want signature validation during development, remove `JIRA_WEBHOOK_SECRET` from `.env` — the server will skip validation.

### Slack challenge verification fails

- Make sure your server is running and accessible at the public URL.
- The `/slack/events` endpoint handles the `url_verification` challenge automatically.
- Check the server logs for errors.

### Session not resuming on Slack reply

- Only **thread replies** are processed. Direct channel messages are ignored.
- Make sure the bot is invited to the channel.
- Check that the `message.channels` and/or `message.im` events are subscribed in the Slack app.

### OpenCode connection refused

- Verify OpenCode is running: `curl http://localhost:4096`
- Check that `OPENCODE_URL` in `.env` matches the actual OpenCode address.
- If OpenCode is on a different machine, update the URL accordingly.

### SQLite errors

- Node.js 22+ is required for the built-in `node:sqlite` module.
- Check your Node version: `node --version`
- The database is created automatically at `data/routing.db`. Make sure the `data/` directory is writable (it is auto-created on startup).

### Jira transitions fail

- The Jira API user needs permission to transition issues in the project.
- The transition name must match exactly. Check your workflow configuration.
- Look for transition-related errors in the server logs.

### Swagger UI not loading

- Browse to `http://localhost:3000/docs` — the Swagger UI is served automatically.
- Make sure the server started without errors.
