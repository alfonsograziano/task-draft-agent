# Implement Task Pipeline

An automated pipeline that picks up Jira issues, creates AI agent sessions via OpenCode, and coordinates task progress through Slack. When a Jira issue transitions to a new state (by default) "Ready for Investigation", the system spins up an OpenCode session, posts a Slack thread, and lets the AI agent work autonomously — with humans able to intervene at any point via thread replies.


## Getting Started

See the [Setup Guide](SETUP_GUIDE.md) for full step-by-step instructions covering Slack app creation, Jira configuration, environment setup, and deployment.

## Workflow

1. A Jira issue is transitioned to "Ready for Investigation" (or your customized status)
2. Jira webhook triggers the management server
3. Management server creates an OpenCode session and a Slack thread
4. The agent receives a task prompt (from `config/prompts/task.md`) and starts working
5. The agent can contact team members via `/api/contact` with urgency levels (`info`, `question`, `blocker`)
6. When a human replies in the Slack thread, the session resumes with their feedback
7. The agent implements the changes, opens a draft PR, and posts results to Slack

## Customization

| File | What to customize |
|------|-------------------|
| `config/prompts/task.md` | Task prompt template sent to the AI agent |
| `config/team-members.json` | Team members, roles, and code areas |


## License

MIT


Built with ❤️ while experimenting
