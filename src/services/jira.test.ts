import "../test-env.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import {
  JiraService,
  type JiraIssuePayload,
  type ParsedJiraIssue,
} from "./jira.ts";

function makePayload(overrides?: Partial<JiraIssuePayload>): JiraIssuePayload {
  return {
    issue: {
      key: "PROJ-1",
      fields: {
        summary: "Fix login bug",
        description: "Users cannot log in",
        reporter: { displayName: "Alice", emailAddress: "alice@example.com" },
        priority: { name: "High" },
      },
    },
    changelog: {
      items: [
        {
          field: "status",
          fromString: "To Do",
          toString: "Ready for Investigation",
        },
      ],
    },
    ...overrides,
  };
}

describe("JiraService", () => {
  describe("parseWebhook", () => {
    it("should extract all fields from a payload", () => {
      const service = new JiraService();
      const result = service.parseWebhook(makePayload());

      assert.equal(result.jiraKey, "PROJ-1");
      assert.equal(result.summary, "Fix login bug");
      assert.equal(result.reporterName, "Alice");
      assert.equal(result.reporterEmail, "alice@example.com");
      assert.equal(result.priority, "High");
      assert.equal(result.description, "Users cannot log in");
    });

    it("should use defaults for missing optional fields", () => {
      const service = new JiraService();
      const result = service.parseWebhook({
        issue: {
          key: "PROJ-2",
          fields: { summary: "" },
        },
      });

      assert.equal(result.jiraKey, "PROJ-2");
      assert.equal(result.summary, "No summary provided");
      assert.equal(result.reporterName, "Unknown");
      assert.equal(result.reporterEmail, undefined);
      assert.equal(result.priority, "medium");
    });

    it("should JSON-stringify non-string descriptions", () => {
      const service = new JiraService();
      const result = service.parseWebhook({
        issue: {
          key: "PROJ-3",
          fields: {
            summary: "Test",
            description: { type: "doc", content: [] } as unknown as string,
          },
        },
      });

      assert.ok(result.description.includes('"type"'));
      assert.ok(result.description.includes('"doc"'));
    });
  });

  describe("isStatusChangeToTarget", () => {
    it("should return true when status changes to target", () => {
      const service = new JiraService({
        targetStatus: "ready for investigation",
      });
      assert.equal(service.isStatusChangeToTarget(makePayload()), true);
    });

    it("should be case-insensitive", () => {
      const service = new JiraService({ targetStatus: "READY FOR INVESTIGATION" });
      assert.equal(service.isStatusChangeToTarget(makePayload()), true);
    });

    it("should return false when no changelog", () => {
      const service = new JiraService();
      const payload = makePayload();
      delete payload.changelog;
      assert.equal(service.isStatusChangeToTarget(payload), false);
    });

    it("should return false when status changes to a different value", () => {
      const service = new JiraService({ targetStatus: "done" });
      assert.equal(service.isStatusChangeToTarget(makePayload()), false);
    });

    it("should return false for non-status field changes", () => {
      const service = new JiraService();
      const payload = makePayload({
        changelog: {
          items: [
            { field: "priority", fromString: "Low", toString: "High" },
          ],
        },
      });
      assert.equal(service.isStatusChangeToTarget(payload), false);
    });
  });

  describe("buildTaskPrompt", () => {
    it("should throw when template file does not exist", () => {
      const service = new JiraService({ templatePath: "/nonexistent/path" });
      const issue: ParsedJiraIssue = {
        jiraKey: "PROJ-10",
        summary: "Add feature",
        reporterName: "Bob",
        priority: "Medium",
        description: "Detailed description here",
      };

      assert.throws(
        () =>
          service.buildTaskPrompt({
            issue,
            sessionId: "sess-abc",
            slackChannel: "C_CHAN",
            slackThreadTs: "thread.123",
          }),
        { message: /Template file not found/ },
      );
    });

    it("should replace all placeholders in template", () => {
      const tmpDir = import.meta.dirname;
      const tmpFile = path.join(tmpDir, "__test_template.md");
      writeFileSync(
        tmpFile,
        "Key:{{JIRA_KEY}} Summary:{{SUMMARY}} Reporter:{{REPORTER_NAME}} Priority:{{PRIORITY}} Desc:{{DESCRIPTION}} Session:{{SESSION_ID}} Channel:{{SLACK_CHANNEL}} Thread:{{SLACK_THREAD_TS}}",
      );

      try {
        const service = new JiraService({ templatePath: tmpFile });
        const issue: ParsedJiraIssue = {
          jiraKey: "PROJ-10",
          summary: "Add feature",
          reporterName: "Bob",
          priority: "Medium",
          description: "Detailed description here",
        };

        const prompt = service.buildTaskPrompt({
          issue,
          sessionId: "sess-abc",
          slackChannel: "C_CHAN",
          slackThreadTs: "thread.123",
        });

        assert.ok(prompt.includes("PROJ-10"));
        assert.ok(prompt.includes("Add feature"));
        assert.ok(prompt.includes("Bob"));
        assert.ok(prompt.includes("Medium"));
        assert.ok(prompt.includes("Detailed description here"));
        assert.ok(prompt.includes("sess-abc"));
        assert.ok(prompt.includes("C_CHAN"));
        assert.ok(prompt.includes("thread.123"));
        assert.ok(!prompt.includes("{{"));
      } finally {
        unlinkSync(tmpFile);
      }
    });

    it("should handle missing optional context", () => {
      const tmpDir = import.meta.dirname;
      const tmpFile = path.join(tmpDir, "__test_template2.md");
      writeFileSync(
        tmpFile,
        "Key:{{JIRA_KEY}} Desc:{{DESCRIPTION}} Channel:{{SLACK_CHANNEL}} Thread:{{SLACK_THREAD_TS}}",
      );

      try {
        const service = new JiraService({ templatePath: tmpFile });
        const issue: ParsedJiraIssue = {
          jiraKey: "PROJ-11",
          summary: "Test",
          reporterName: "Eve",
          priority: "Low",
          description: "",
        };

        const prompt = service.buildTaskPrompt({
          issue,
          sessionId: "sess-xyz",
        });

        assert.ok(prompt.includes("PROJ-11"));
        assert.ok(prompt.includes("No description provided"));
        assert.ok(!prompt.includes("{{SLACK_CHANNEL}}"));
        assert.ok(!prompt.includes("{{SLACK_THREAD_TS}}"));
      } finally {
        unlinkSync(tmpFile);
      }
    });
  });
});
