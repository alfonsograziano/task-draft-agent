const requiredKeys = [
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_CHANNEL",
  "JIRA_BASE_URL",
  "JIRA_USER_EMAIL",
  "JIRA_API_TOKEN",
];

for (const key of requiredKeys) {
  process.env[key] ??= `test-${key}`;
}
