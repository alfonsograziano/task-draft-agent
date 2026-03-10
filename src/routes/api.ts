import type { FastifyInstance } from "fastify";
import { getTeamMembers } from "../services/team.ts";

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/team-members", {
    schema: {
      tags: ["team"],
      summary: "List team members",
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              slack_user_id: { type: "string" },
              areas: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const members = getTeamMembers();
      return reply.send(members);
    },
  });
}
