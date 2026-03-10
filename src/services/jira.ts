import { readFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config.ts";

export interface JiraIssuePayload {
  issue: {
    key: string;
    fields: {
      summary: string;
      description?: string;
      reporter?: {
        displayName: string;
        emailAddress?: string;
      };
      priority?: {
        name: string;
      };
      [key: string]: unknown;
    };
  };
  changelog?: {
    items: Array<{
      field: string;
      fromString: string;
      toString: string;
    }>;
  };
}

export interface ParsedJiraIssue {
  jiraKey: string;
  summary: string;
  reporterName: string;
  reporterEmail?: string;
  priority: string;
  description: string;
}

export interface TaskPromptContext {
  issue: ParsedJiraIssue;
  sessionId: string;
  slackChannel?: string;
  slackThreadTs?: string;
}

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export class JiraService {
  private targetStatus: string;
  private credentials?: JiraCredentials;
  private templatePath: string;

  constructor(opts?: {
    targetStatus?: string;
    credentials?: JiraCredentials;
    templatePath?: string;
  }) {
    const config = getConfig();
    this.targetStatus = (
      opts?.targetStatus ||
      config.JIRA_TRIGGER_STATUS
    ).toLowerCase();

    this.templatePath =
      opts?.templatePath ||
      path.resolve(process.cwd(), "config/prompts/task.md");

    const baseUrl = opts?.credentials?.baseUrl || config.JIRA_BASE_URL;
    const email = opts?.credentials?.email || config.JIRA_USER_EMAIL;
    const apiToken = opts?.credentials?.apiToken || config.JIRA_API_TOKEN;

    if (baseUrl && email && apiToken) {
      this.credentials = { baseUrl, email, apiToken };
    }
  }

  parseWebhook(payload: JiraIssuePayload): ParsedJiraIssue {
    const { issue } = payload;
    const fields = issue.fields;

    const description =
      typeof fields.description === "string"
        ? fields.description
        : JSON.stringify(fields.description || "");

    return {
      jiraKey: issue.key,
      summary: fields.summary || "No summary provided",
      reporterName: fields.reporter?.displayName || "Unknown",
      reporterEmail: fields.reporter?.emailAddress,
      priority: fields.priority?.name || "medium",
      description,
    };
  }

  isStatusChangeToTarget(payload: JiraIssuePayload): boolean {
    if (!payload.changelog?.items) return false;
    return payload.changelog.items.some(
      (item) =>
        item.field === "status" &&
        item.toString.toLowerCase().includes(this.targetStatus),
    );
  }

  async transitionIssue(
    jiraKey: string,
    transitionName: string,
  ): Promise<void> {
    if (!this.credentials) {
      console.warn("[jira] Missing Jira credentials, skipping transition");
      return;
    }

    const auth = Buffer.from(
      `${this.credentials.email}:${this.credentials.apiToken}`,
    ).toString("base64");

    const transitionsRes = await fetch(
      `${this.credentials.baseUrl}/rest/api/3/issue/${jiraKey}/transitions`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      },
    );

    if (!transitionsRes.ok) {
      console.error(`[jira] Failed to get transitions for ${jiraKey}`);
      return;
    }

    const { transitions } = (await transitionsRes.json()) as {
      transitions: Array<{ id: string; name: string }>;
    };
    const target = transitions.find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase(),
    );

    if (!target) {
      console.warn(
        `[jira] Transition "${transitionName}" not found for ${jiraKey}`,
      );
      return;
    }

    const res = await fetch(
      `${this.credentials.baseUrl}/rest/api/3/issue/${jiraKey}/transitions`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transition: { id: target.id } }),
      },
    );

    if (!res.ok) {
      console.error(`[jira] Failed to transition ${jiraKey}: ${res.status}`);
    } else {
      console.log(`[jira] Transitioned ${jiraKey} to "${transitionName}"`);
    }
  }

  buildTaskPrompt(ctx: TaskPromptContext): string {
    let template: string;
    try {
      template = readFileSync(this.templatePath, "utf-8");
    } catch (err) {
      throw new Error(
        `Template file not found at ${this.templatePath}`,
        { cause: err },
      );
    }

    const replacements: Record<string, string> = {
      "{{JIRA_KEY}}": ctx.issue.jiraKey,
      "{{SUMMARY}}": ctx.issue.summary,
      "{{REPORTER_NAME}}": ctx.issue.reporterName,
      "{{PRIORITY}}": ctx.issue.priority,
      "{{DESCRIPTION}}": ctx.issue.description || "No description provided",
      "{{SESSION_ID}}": ctx.sessionId,
      "{{SLACK_CHANNEL}}": ctx.slackChannel || "",
      "{{SLACK_THREAD_TS}}": ctx.slackThreadTs || "",
    };

    let prompt = template;
    for (const [key, value] of Object.entries(replacements)) {
      prompt = prompt.replaceAll(key, value);
    }

    return prompt;
  }
}
