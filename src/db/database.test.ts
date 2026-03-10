import "../test-env.ts";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Database } from "./database.ts";

describe("Database", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("tasks", () => {
    it("should create and retrieve a task", () => {
      db.createTask("PROJ-1", "session-1", "thread-ts-1");

      const task = db.getTaskByJiraKey("PROJ-1");
      assert.equal(task?.jira_key, "PROJ-1");
      assert.equal(task?.opencode_session_id, "session-1");
      assert.equal(task?.main_slack_thread_ts, "thread-ts-1");
      assert.ok(task?.created_at);
    });

    it("should create a task without slack thread", () => {
      db.createTask("PROJ-2", "session-2");

      const task = db.getTaskByJiraKey("PROJ-2");
      assert.equal(task?.jira_key, "PROJ-2");
      assert.equal(task?.main_slack_thread_ts, null);
    });

    it("should return undefined for non-existent task", () => {
      const task = db.getTaskByJiraKey("NOPE-1");
      assert.equal(task, undefined);
    });

    it("should update task thread", () => {
      db.createTask("PROJ-3", "session-3");
      db.updateTaskThread("PROJ-3", "new-thread-ts");

      const task = db.getTaskByJiraKey("PROJ-3");
      assert.equal(task?.main_slack_thread_ts, "new-thread-ts");
    });
  });

  describe("slack threads", () => {
    it("should create and retrieve a slack thread", () => {
      db.createSlackThread("ts-1", "channel-1", "session-1", "user-1");

      const thread = db.getSessionBySlackThread("ts-1");
      assert.equal(thread?.slack_thread_ts, "ts-1");
      assert.equal(thread?.slack_channel, "channel-1");
      assert.equal(thread?.opencode_session_id, "session-1");
      assert.equal(thread?.target_user, "user-1");
      assert.ok(thread?.created_at);
    });

    it("should create a slack thread without target user", () => {
      db.createSlackThread("ts-2", "channel-1", "session-1");

      const thread = db.getSessionBySlackThread("ts-2");
      assert.equal(thread?.target_user, null);
    });

    it("should return undefined for non-existent thread", () => {
      const thread = db.getSessionBySlackThread("nope");
      assert.equal(thread, undefined);
    });

    it("should upsert slack thread on conflict", () => {
      db.createSlackThread("ts-1", "channel-1", "session-1");
      db.createSlackThread("ts-1", "channel-2", "session-2", "user-2");

      const thread = db.getSessionBySlackThread("ts-1");
      assert.equal(thread?.slack_channel, "channel-2");
      assert.equal(thread?.opencode_session_id, "session-2");
    });

    it("should get threads by session", () => {
      db.createSlackThread("ts-1", "ch-1", "session-1");
      db.createSlackThread("ts-2", "ch-2", "session-1");
      db.createSlackThread("ts-3", "ch-3", "session-2");

      const threads = db.getThreadsBySession("session-1");
      assert.equal(threads.length, 2);
    });
  });
});
