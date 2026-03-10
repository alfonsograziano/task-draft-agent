import "../test-env.ts";
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../index.ts";
import { Database } from "../db/database.ts";

const mockSlackService = {
  processEvent: mock.fn(async (_event: unknown) => {}),
};

let app: FastifyInstance;

before(async () => {
  app = await buildApp({
    slackService: mockSlackService as never,
    database: new Database(":memory:") as never,
  });
});

after(async () => {
  await app.close();
});

beforeEach(() => {
  mockSlackService.processEvent.mock.resetCalls();
  mockSlackService.processEvent.mock.mockImplementation(async () => {});
});

describe("/slack/events", () => {
  it("should respond with challenge for url_verification", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/slack/events",
      payload: {
        type: "url_verification",
        challenge: "test-challenge-token",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().challenge, "test-challenge-token");
    assert.equal(mockSlackService.processEvent.mock.callCount(), 0);
  });

  it("should forward event_callback to slackService.processEvent", async () => {
    const payload = {
      type: "event_callback",
      event: {
        type: "message",
        text: "hello",
        channel: "C123",
        user: "U456",
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/slack/events",
      payload,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(mockSlackService.processEvent.mock.callCount(), 1);

    const call = mockSlackService.processEvent.mock.calls[0]!;
    const receiverEvent = call.arguments[0] as Record<string, unknown>;
    assert.deepEqual(receiverEvent.body, payload);
    assert.equal(typeof receiverEvent.ack, "function");
  });

  it("should return 200 for non-event_callback types", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/slack/events",
      payload: {
        type: "some_other_type",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(mockSlackService.processEvent.mock.callCount(), 0);
  });

  it("should return 200 even when processEvent throws", async () => {
    mockSlackService.processEvent.mock.mockImplementation(async () => {
      throw new Error("Slack processing failed");
    });

    const response = await app.inject({
      method: "POST",
      url: "/slack/events",
      payload: {
        type: "event_callback",
        event: { type: "message", text: "boom" },
      },
    });

    assert.equal(response.statusCode, 200);
  });

  it("should pass retry headers to processEvent", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/slack/events",
      headers: {
        "x-slack-retry-num": "2",
        "x-slack-retry-reason": "http_timeout",
      },
      payload: {
        type: "event_callback",
        event: { type: "message", text: "retry" },
      },
    });

    assert.equal(response.statusCode, 200);
    const call = mockSlackService.processEvent.mock.calls[0]!;
    const receiverEvent = call.arguments[0] as Record<string, unknown>;
    assert.equal(receiverEvent.retryNum, 2);
    assert.equal(receiverEvent.retryReason, "http_timeout");
  });
});
