import "../test-env.ts";
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { SlackService } from "./slack.ts";

interface PostMessageArgs {
  channel: string;
  text: string;
  thread_ts?: string;
}

function createMockApp() {
  const messageHandlers: Array<(event: Record<string, unknown>) => Promise<void>> = [];
  return {
    client: {
      chat: {
        postMessage: mock.fn(async (_opts: PostMessageArgs) => ({ ts: "msg.ts.123" })),
      },
      conversations: {
        open: mock.fn(async (_opts: { users: string }) => ({ channel: { id: "DM_CHANNEL" } })),
      },
      users: {
        info: mock.fn(async (_opts: { user: string }) => ({
          user: { real_name: "Alice", name: "alice" },
        })),
      },
    },
    message: (handler: (event: Record<string, unknown>) => Promise<void>) => {
      messageHandlers.push(handler);
    },
    _messageHandlers: messageHandlers,
  };
}

function createMockDb() {
  return {
    getSessionBySlackThread: mock.fn((_threadTs: string) => undefined as
      | {
          slack_thread_ts: string;
          slack_channel: string;
          opencode_session_id: string;
          target_user: string | null;
          created_at: string;
        }
      | undefined),
    createSlackThread: mock.fn(
      (_threadTs: string, _channel: string, _sessionId: string, _targetUser?: string) => {},
    ),
  };
}

function createMockOpencode() {
  return {
    resumeSessionWithReply: mock.fn(
      async (_sessionId: string, _senderName: string, _message: string) => {},
    ),
  };
}

describe("SlackService", () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockOpencode: ReturnType<typeof createMockOpencode>;
  let service: SlackService;

  beforeEach(() => {
    mockApp = createMockApp();
    mockDb = createMockDb();
    mockOpencode = createMockOpencode();
    service = new SlackService(
      mockApp as never,
      mockDb as never,
      mockOpencode as never,
    );
  });

  describe("postToThread", () => {
    it("should post a message to a thread with footer", async () => {
      const result = await service.postToThread("C123", "thread.ts", "Hello");

      assert.equal(result, "msg.ts.123");
      assert.equal(mockApp.client.chat.postMessage.mock.callCount(), 1);
      const call = mockApp.client.chat.postMessage.mock.calls[0]!.arguments[0]!;
      assert.equal(call.channel, "C123");
      assert.equal(call.thread_ts, "thread.ts");
      assert.ok(call.text.includes("Hello"));
      assert.ok(call.text.includes("reply in this thread"));
    });
  });

  describe("startTaskThread", () => {
    it("should post a task thread message", async () => {
      const result = await service.startTaskThread(
        "C123",
        "PROJ-42",
        "Fix the bug",
      );

      assert.equal(result, "msg.ts.123");
      const call = mockApp.client.chat.postMessage.mock.calls[0]!.arguments[0]!;
      assert.equal(call.channel, "C123");
      assert.ok(call.text.includes("PROJ-42"));
      assert.ok(call.text.includes("Fix the bug"));
    });
  });

  describe("sendDirectMessage", () => {
    it("should open a DM, post a message, and track the thread", async () => {
      const result = await service.sendDirectMessage(
        "U_USER",
        "Hey there",
        "session-1",
      );

      assert.equal(result.channel, "DM_CHANNEL");
      assert.equal(result.threadTs, "msg.ts.123");

      assert.equal(mockApp.client.conversations.open.mock.callCount(), 1);
      assert.equal(mockApp.client.chat.postMessage.mock.callCount(), 1);

      const postCall =
        mockApp.client.chat.postMessage.mock.calls[0]!.arguments[0]!;
      assert.equal(postCall.channel, "DM_CHANNEL");
      assert.ok(postCall.text.includes("Hey there"));
      assert.ok(postCall.text.includes("reply in this thread"));

      assert.equal(mockDb.createSlackThread.mock.callCount(), 1);
      const dbCall = mockDb.createSlackThread.mock.calls[0]!.arguments;
      assert.equal(dbCall[0], "msg.ts.123");
      assert.equal(dbCall[1], "DM_CHANNEL");
      assert.equal(dbCall[2], "session-1");
      assert.equal(dbCall[3], "U_USER");
    });
  });

  describe("message event handler", () => {
    it("should ignore non-thread messages", async () => {
      const handler = mockApp._messageHandlers[0]!;
      await handler({
        message: { ts: "1.0", text: "hello", user: "U1", channel: "C1" },
      });

      assert.equal(mockDb.getSessionBySlackThread.mock.callCount(), 0);
    });

    it("should ignore bot messages", async () => {
      const handler = mockApp._messageHandlers[0]!;
      await handler({
        message: {
          ts: "2.0",
          thread_ts: "1.0",
          text: "hello",
          user: "U1",
          channel: "C1",
          bot_id: "B1",
        },
      });

      assert.equal(mockDb.getSessionBySlackThread.mock.callCount(), 0);
    });

    it("should ignore threads not tracked in db", async () => {
      const handler = mockApp._messageHandlers[0]!;
      mockDb.getSessionBySlackThread.mock.mockImplementation(() => undefined);

      await handler({
        message: {
          ts: "2.0",
          thread_ts: "1.0",
          text: "hello",
          user: "U1",
          channel: "C1",
        },
      });

      assert.equal(mockDb.getSessionBySlackThread.mock.callCount(), 1);
      assert.equal(mockOpencode.resumeSessionWithReply.mock.callCount(), 0);
    });

    it("should resume session for tracked thread replies", async () => {
      const handler = mockApp._messageHandlers[0]!;
      mockDb.getSessionBySlackThread.mock.mockImplementation(() => ({
        opencode_session_id: "sess-1",
        slack_thread_ts: "1.0",
        slack_channel: "C1",
        target_user: null,
        created_at: "2025-01-01",
      }));

      await handler({
        message: {
          ts: "2.0",
          thread_ts: "1.0",
          text: "my reply",
          user: "U1",
          channel: "C1",
        },
      });

      assert.equal(mockOpencode.resumeSessionWithReply.mock.callCount(), 1);
      const args =
        mockOpencode.resumeSessionWithReply.mock.calls[0]!.arguments;
      assert.equal(args[0], "sess-1");
      assert.equal(args[1], "Alice");
      assert.equal(args[2], "my reply");
    });
  });
});
