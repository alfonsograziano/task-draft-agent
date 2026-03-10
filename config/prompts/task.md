# Task Prompt Template

This template is used by the management server to construct the initial prompt sent to the OpenCode session when a Jira issue is picked up. Customize it to include domain-specific steps or codebase conventions.

---

## {{JIRA_KEY}}: {{SUMMARY}}

**Reporter:** {{REPORTER_NAME}}
**Priority:** {{PRIORITY}}

### Description
{{DESCRIPTION}}

---

## Your Task

You are working on Jira issue **{{JIRA_KEY}}**. Your session ID is `{{SESSION_ID}}`.

A Slack thread has been created for this task:
- **Channel:** `{{SLACK_CHANNEL}}`
- **Thread:** `{{SLACK_THREAD_TS}}`

Use the `/api/contact` endpoint (documented below) to send messages to this thread. You can send status updates, ask questions, or share results (e.g. a PR link once you're done).

### Steps

1. Read and understand the task description above
2. Fetch the team members list to know who you can contact
3. Explore the codebase to locate the relevant area
4. Implement the changes needed
5. Add or update tests as appropriate
6. Open a draft PR
7. Post the PR link and a summary to the Slack thread

Try to solve it yourself first. Only contact someone when you genuinely need information you cannot find in the code, logs, or tests.

---

## Management Server API

Base URL: `http://localhost:3000`

### GET /api/team-members

Returns the list of team members you can contact.

**Response (200):**
```json
[
  {
    "name": "string",
    "role": "string",
    "slack_user_id": "string",
    "areas": ["string"]
  }
]
```

### POST /api/contact

Send a Slack message to the task thread or directly to a team member.

**Request body:**
```json
{
  "session_id": "string (required) — your session ID",
  "target": "string (required) — a slack_user_id from team members, or \"thread\" to post to the task thread",
  "message": "string (required) — the text to send",
  "urgency": "string (optional) — one of: \"info\", \"question\", \"blocker\". Adds a label prefix to the message."
}
```

**Urgency levels (optional):**
- `info` — FYI, continue working
- `question` — you have a question, you may continue working while waiting
- `blocker` — you are blocked and cannot proceed. **Stop your turn and wait.** The session will be resumed when the human replies.

If omitted, the message is sent as-is without any label.

**Response (200):**
```json
{ "ok": true }
```
