import type { FastifyInstance } from "fastify";

export async function slackEventsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>(
    "/slack/events",
    {
      schema: {
        tags: ["slack"],
        summary: "Receive Slack events",
        body: {
          type: "object",
          properties: {
            type: { type: "string" },
            challenge: { type: "string" },
            event: { type: "object" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    async function (request, reply) {
      const body = request.body;

      if (body.type === "url_verification") {
        return reply.send({ challenge: body.challenge });
      }

      const { slackService } = this;
      if (!slackService) {
        request.log.warn("[slack] No SlackService configured, ignoring event");
        return reply.status(200).send();
      }

      try {
        const event = body.event as Record<string, unknown> | undefined;
        if (event && body.type === "event_callback") {
          let responded = false;

          await slackService.processEvent({
            body,
            ack: async (response?: unknown) => {
              if (responded) return;
              responded = true;
              if (response) {
                return reply.send(response);
              }
              return reply.status(200).send();
            },
            retryNum:
              Number(request.headers["x-slack-retry-num"]) || undefined,
            retryReason: request.headers["x-slack-retry-reason"] as
              | string
              | undefined,
            customProperties: {},
          });

          if (!responded) {
            return reply.status(200).send();
          }
          return;
        }

        return reply.status(200).send();
      } catch (error) {
        request.log.error({ err: error }, "[slack] Error processing event");
        return reply.status(200).send();
      }
    },
  );
}
