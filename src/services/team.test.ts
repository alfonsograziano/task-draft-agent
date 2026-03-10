import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getTeamMembers, findTeamMemberBySlackId } from "./team.ts";

describe("team", () => {
  describe("getTeamMembers", () => {
    it("should return a non-empty array of team members", () => {
      const members = getTeamMembers();
      assert.ok(Array.isArray(members));
      assert.ok(members.length > 0);
    });

    it("should return members with required fields", () => {
      const members = getTeamMembers();
      for (const member of members) {
        assert.ok(typeof member.name === "string");
        assert.ok(typeof member.role === "string");
        assert.ok(typeof member.slack_user_id === "string");
        assert.ok(Array.isArray(member.areas));
      }
    });
  });

  describe("findTeamMemberBySlackId", () => {
    it("should find a member by slack user id", () => {
      const members = getTeamMembers();
      const first = members[0];
      const found = findTeamMemberBySlackId(first.slack_user_id);
      assert.deepStrictEqual(found, first);
    });

    it("should return undefined for unknown slack id", () => {
      const found = findTeamMemberBySlackId("UNKNOWN_ID");
      assert.strictEqual(found, undefined);
    });
  });
});
