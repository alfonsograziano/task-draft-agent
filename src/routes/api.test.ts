import "../test-env.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../index.ts";
import { Database } from "../db/database.ts";

let app: FastifyInstance;

before(async () => {
  app = await buildApp({
    database: new Database(":memory:"),
    slackService: {} as never,
  });
});

after(async () => {
  await app.close();
});

describe("/api/team-members", () => {
  it("should return 200 with an array of team members", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/team-members",
    });

    assert.strictEqual(response.statusCode, 200);

    const body = response.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);

    for (const member of body) {
      assert.ok(typeof member.name === "string");
      assert.ok(typeof member.role === "string");
      assert.ok(typeof member.slack_user_id === "string");
      assert.ok(Array.isArray(member.areas));
    }
  });
});
