import "../test-env.ts";
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../index.ts";
import type { JiraIssuePayload } from "../services/jira.ts";
import { resetConfig } from "../config.ts";

function makePayload(overrides?: Partial<JiraIssuePayload>): JiraIssuePayload {
  return {
    issue: {
      key: "PROJ-1",
      fields: {
        summary: "Fix login bug",
        description: "Users cannot log in",
        reporter: { displayName: "Alice" },
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

const mockJira = {
  isStatusChangeToTarget: mock.fn((payload: JiraIssuePayload) => {
    if (!payload.changelog?.items) return false;
    return payload.changelog.items.some(
      (item) =>
        item.field === "status" &&
        item.toString.toLowerCase().includes("ready for investigation"),
    );
  }),
  parseWebhook: mock.fn((payload: JiraIssuePayload) => ({
    jiraKey: payload.issue.key,
    summary: payload.issue.fields.summary || "No summary provided",
    reporterName: payload.issue.fields.reporter?.displayName || "Unknown",
    reporterEmail: payload.issue.fields.reporter?.emailAddress,
    priority: payload.issue.fields.priority?.name || "medium",
    description: payload.issue.fields.description || "",
  })),
  buildTaskPrompt: mock.fn(() => "mock prompt"),
};

const mockOpencode = {
  createSession: mock.fn(async (_title: string) => "sess-123"),
  sendPrompt: mock.fn(async (_sid: string, _text: string) => {}),
};

const mockDb = {
  getTaskByJiraKey: mock.fn((_key: string) => undefined as unknown),
  createTask: mock.fn((_key: string, _sid: string, _ts?: string) => {}),
  createSlackThread: mock.fn((_ts: string, _ch: string, _sid: string) => {}),
};

let app: FastifyInstance;

const noopSlackService = {
  startTaskThread: mock.fn(async () => "thread-ts"),
  postToThread: mock.fn(async () => "ts"),
  sendDirectMessage: mock.fn(async () => ({ channel: "ch", threadTs: "ts" })),
  processEvent: mock.fn(async () => {}),
};

before(async () => {
  app = await buildApp({
    jira: mockJira as never,
    opencode: mockOpencode as never,
    database: mockDb as never,
    slackService: noopSlackService as never,
  });
});

after(async () => {
  await app.close();
});

beforeEach(() => {
  mockJira.isStatusChangeToTarget.mock.resetCalls();
  mockJira.parseWebhook.mock.resetCalls();
  mockJira.buildTaskPrompt.mock.resetCalls();
  mockOpencode.createSession.mock.resetCalls();
  mockOpencode.createSession.mock.mockImplementation(async () => "sess-123");
  mockOpencode.sendPrompt.mock.resetCalls();
  mockDb.getTaskByJiraKey.mock.resetCalls();
  mockDb.getTaskByJiraKey.mock.mockImplementation(() => undefined);
  mockDb.createTask.mock.resetCalls();
  mockDb.createSlackThread.mock.resetCalls();
});

describe("/webhooks/jira", () => {
  it("should return { ok, sessionId, jiraKey } on success", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jira",
      payload: makePayload(),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.sessionId, "sess-123");
    assert.equal(body.jiraKey, "PROJ-1");
  });

  it("should return { ignored: true } when not a target status change", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jira",
      payload: makePayload({
        changelog: {
          items: [
            { field: "status", fromString: "To Do", toString: "In Progress" },
          ],
        },
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ignored, true);
  });

  it("should return { duplicate: true } when task already exists", async () => {
    mockDb.getTaskByJiraKey.mock.mockImplementation(() => ({
      jira_key: "PROJ-1",
      opencode_session_id: "old-sess",
      main_slack_thread_ts: null,
      created_at: "2025-01-01",
    }));

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jira",
      payload: makePayload(),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().duplicate, true);
  });

  it("should store the task in the database", async () => {
    await app.inject({
      method: "POST",
      url: "/webhooks/jira",
      payload: makePayload(),
    });

    assert.equal(mockDb.createTask.mock.callCount(), 1);
    const args = mockDb.createTask.mock.calls[0]!.arguments;
    assert.equal(args[0], "PROJ-1");
    assert.equal(args[1], "sess-123");
  });

  it("should return 500 when opencode session creation fails", async () => {
    mockOpencode.createSession.mock.mockImplementation(async () => {
      throw new Error("connection refused");
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jira",
      payload: makePayload(),
    });

    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error, "Failed to start task");
  });

  describe("slack integration", () => {
    let appWithSlack: FastifyInstance;
    const mockSlackService = {
      startTaskThread: mock.fn(async () => "thread-ts-abc"),
      postToThread: mock.fn(async () => "ts"),
      sendDirectMessage: mock.fn(async () => ({
        channel: "ch",
        threadTs: "ts",
      })),
      processEvent: mock.fn(async () => {}),
    };

    let origChannel: string | undefined;

    before(async () => {
      origChannel = process.env.SLACK_CHANNEL;
      process.env.SLACK_CHANNEL = "C_TEST_CHANNEL";
      resetConfig();
      appWithSlack = await buildApp({
        jira: mockJira as never,
        opencode: mockOpencode as never,
        database: mockDb as never,
        slackService: mockSlackService as never,
      });
    });

    after(async () => {
      process.env.SLACK_CHANNEL = origChannel ?? "test-SLACK_CHANNEL";
      resetConfig();
      await appWithSlack.close();
    });

    beforeEach(() => {
      mockSlackService.startTaskThread.mock.resetCalls();
      mockDb.createSlackThread.mock.resetCalls();
    });

    it("should send a Slack message when starting a new task", async () => {
      const response = await appWithSlack.inject({
        method: "POST",
        url: "/webhooks/jira",
        payload: makePayload(),
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().ok, true);

      // Verify startTaskThread was called
      assert.equal(mockSlackService.startTaskThread.mock.callCount(), 1);
      const slackArgs = mockSlackService.startTaskThread.mock.calls[0]
        .arguments as unknown as string[];
      assert.equal(slackArgs[0], "C_TEST_CHANNEL");
      assert.equal(slackArgs[1], "PROJ-1");
      assert.equal(slackArgs[2], "Fix login bug");

      // Verify the slack thread was stored in the database
      assert.equal(mockDb.createSlackThread.mock.callCount(), 1);
      const threadArgs = mockDb.createSlackThread.mock.calls[0]
        .arguments as unknown as string[];
      assert.equal(threadArgs[0], "thread-ts-abc");
      assert.equal(threadArgs[1], "C_TEST_CHANNEL");
      assert.equal(threadArgs[2], "sess-123");

      // Verify the task was created with the thread ts
      const taskArgs = mockDb.createTask.mock.calls[0]
        .arguments as unknown as string[];
      assert.equal(taskArgs[2], "thread-ts-abc");
    });

  });

  describe("signature validation", () => {
    const secret = "test-secret";
    let origSecret: string | undefined;

    before(() => {
      origSecret = process.env.JIRA_WEBHOOK_SECRET;
      process.env.JIRA_WEBHOOK_SECRET = secret;
      resetConfig();
    });

    after(() => {
      process.env.JIRA_WEBHOOK_SECRET = origSecret;
      resetConfig();
    });

    function sign(body: string): string {
      return (
        "sha256=" +
        crypto.createHmac("sha256", secret).update(body).digest("hex")
      );
    }

    it("should reject requests without signature when secret is set", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/jira",
        payload: makePayload(),
      });

      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error, "Missing signature");
    });

    it("should reject requests with invalid signature", async () => {
      const payload = JSON.stringify(makePayload());
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/jira",
        headers: {
          "content-type": "application/json",
          "x-hub-signature": "sha256=invalid",
        },
        payload,
      });

      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error, "Invalid signature");
    });

    it("should accept requests with valid signature", async () => {
      const payload = JSON.stringify(makePayload());
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/jira",
        headers: {
          "content-type": "application/json",
          "x-hub-signature": sign(payload),
        },
        payload,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().ok, true);
    });
  });
});
