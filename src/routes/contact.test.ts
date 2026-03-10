import "../test-env.ts";
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../index.ts";
import { resetConfig } from "../config.ts";

const mockSlackService = {
  postToThread: mock.fn(
    async (_ch: string, _ts: string, _text: string) => "msg-ts",
  ),
  sendDirectMessage: mock.fn(
    async (_userId: string, _text: string, _sessionId: string) => ({
      channel: "D999",
      threadTs: "dm-ts",
    }),
  ),
  processEvent: mock.fn(async () => {}),
};

const mockDb = {
  getTaskByJiraKey: mock.fn(() => undefined),
  getTaskBySessionId: mock.fn(
    (_sid: string) =>
      undefined as
        | {
            jira_key: string;
            opencode_session_id: string;
            main_slack_thread_ts: string | null;
            created_at: string;
          }
        | undefined,
  ),
  createTask: mock.fn(() => {}),
  createSlackThread: mock.fn(() => {}),
};

let app: FastifyInstance;

before(async () => {
  process.env.SLACK_CHANNEL = "C-test";
  resetConfig();

  app = await buildApp({
    slackService: mockSlackService as never,
    database: mockDb as never,
  });
});

after(async () => {
  await app.close();
});

beforeEach(() => {
  mockSlackService.postToThread.mock.resetCalls();
  mockSlackService.sendDirectMessage.mock.resetCalls();
  mockDb.getTaskBySessionId.mock.resetCalls();
  mockDb.getTaskBySessionId.mock.mockImplementation(() => undefined);
});

describe("POST /api/contact", () => {
  it("should send a DM when target is a user ID", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/contact",
      payload: {
        session_id: "sess-1",
        target: "U123",
        message: "Hello there",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true);

    assert.equal(mockSlackService.sendDirectMessage.mock.callCount(), 1);
    const args = mockSlackService.sendDirectMessage.mock.calls[0]!.arguments;
    assert.equal(args[0], "U123");
    assert.equal(args[1], "Hello there");
    assert.equal(args[2], "sess-1");
  });

  it("should post to thread when target is 'thread'", async () => {
    mockDb.getTaskBySessionId.mock.mockImplementation(() => ({
      jira_key: "PROJ-1",
      opencode_session_id: "sess-1",
      main_slack_thread_ts: "1234.5678",
      created_at: "2025-01-01",
    }));

    const response = await app.inject({
      method: "POST",
      url: "/api/contact",
      payload: {
        session_id: "sess-1",
        target: "thread",
        message: "Status update",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true);

    assert.equal(mockSlackService.postToThread.mock.callCount(), 1);
    const args = mockSlackService.postToThread.mock.calls[0]!.arguments;
    assert.equal(args[0], "C-test");
    assert.equal(args[1], "1234.5678");
    assert.equal(args[2], "Status update");
  });

  it("should return 404 when no thread found for session", async () => {
    mockDb.getTaskBySessionId.mock.mockImplementation(() => undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/contact",
      payload: {
        session_id: "sess-missing",
        target: "thread",
        message: "Hello",
      },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(
      response.json().error,
      "No Slack thread found for this session",
    );
  });

  it("should return 404 when task exists but has no thread", async () => {
    mockDb.getTaskBySessionId.mock.mockImplementation(() => ({
      jira_key: "PROJ-2",
      opencode_session_id: "sess-2",
      main_slack_thread_ts: null,
      created_at: "2025-01-01",
    }));

    const response = await app.inject({
      method: "POST",
      url: "/api/contact",
      payload: {
        session_id: "sess-2",
        target: "thread",
        message: "Hello",
      },
    });

    assert.equal(response.statusCode, 404);
  });

  it("should prepend urgency label when provided", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/contact",
      payload: {
        session_id: "sess-1",
        target: "U123",
        message: "Need help",
        urgency: "blocker",
      },
    });

    assert.equal(response.statusCode, 200);
    const args = mockSlackService.sendDirectMessage.mock.calls[0]!.arguments;
    assert.ok(args[1].includes("🔴 BLOCKER"));
    assert.ok(args[1].includes("Need help"));
  });

  it("should return 500 when slackService.sendDirectMessage throws", async () => {
    mockSlackService.sendDirectMessage.mock.mockImplementation(async () => {
      throw new Error("Slack API error");
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/contact",
      payload: {
        session_id: "sess-1",
        target: "U123",
        message: "Hello",
      },
    });

    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error, "Failed to send message");
  });
});

