import type { FastifyInstance } from "fastify";
import { getConfig } from "../config.ts";

interface ContactBody {
  session_id: string;
  target: string;
  message: string;
  urgency?: "info" | "question" | "blocker";
}

const URGENCY_LABELS: Record<string, string> = {
  blocker: "🔴 BLOCKER",
  question: "🟡 Question",
  info: "ℹ️ Info",
};

function formatMessage(message: string, urgency?: string): string {
  if (!urgency) return message;
  return `*[${URGENCY_LABELS[urgency]}]*\n\n${message}`;
}

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ContactBody }>(
    "/api/contact",
    {
      schema: {
        tags: ["contact"],
        summary: "Send a Slack message to a team member or task thread",
        body: {
          type: "object",
          required: ["session_id", "target", "message"],
          properties: {
            session_id: {
              type: "string",
              description: "OpenCode session ID",
            },
            target: {
              type: "string",
              description: 'Slack user ID or "thread"',
            },
            message: { type: "string", description: "Message text" },
            urgency: {
              type: "string",
              enum: ["info", "question", "blocker"],
              description: "Optional urgency label prepended to the message",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          500: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async function (request, reply) {
      const { database, slackService } = this;
      const { session_id, target, message, urgency } = request.body;

      if (!slackService) {
        return reply
          .status(500)
          .send({ error: "Slack is not configured" });
      }

      const formattedMessage = formatMessage(message, urgency);

      try {
        if (target === "thread") {
          const task = database.getTaskBySessionId(session_id);
          if (!task?.main_slack_thread_ts) {
            return reply
              .status(404)
              .send({ error: "No Slack thread found for this session" });
          }

          await slackService.postToThread(
            getConfig().SLACK_CHANNEL,
            task.main_slack_thread_ts,
            formattedMessage,
          );
        } else {
          await slackService.sendDirectMessage(
            target,
            formattedMessage,
            session_id,
          );
        }

        return reply.send({ ok: true });
      } catch (error) {
        request.log.error({ err: error }, "[contact] Failed to send message");
        return reply.status(500).send({ error: "Failed to send message" });
      }
    },
  );
}
