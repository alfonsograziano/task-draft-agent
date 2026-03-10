import { App, type ReceiverEvent } from "@slack/bolt";
import { Database } from "../db/database.ts";
import { OpencodeService } from "./opencode.ts";

const MESSAGE_FOOTER =
  "\n\n_Please reply in this thread — I can only read replies within the thread._";

export class SlackService {
  private app: App;
  private db: Database;
  private opencode: OpencodeService;

  constructor(app: App, db: Database, opencode: OpencodeService) {
    this.app = app;
    this.db = db;
    this.opencode = opencode;
    this.registerEventHandlers();
  }

  async processEvent(event: ReceiverEvent): Promise<void> {
    return this.app.processEvent(event);
  }

  private registerEventHandlers(): void {
    this.app.message(async ({ message }) => {
      const msg = message as unknown as Record<string, unknown>;
      const threadTs = msg.thread_ts as string | undefined;
      const ts = msg.ts as string;
      const text = msg.text as string | undefined;
      const user = msg.user as string | undefined;
      const channel = msg.channel as string | undefined;

      if (!threadTs || threadTs === ts || !text || !user || !channel) return;

      if (msg.bot_id || msg.subtype === "bot_message") return;

      const threadEntry = this.db.getSessionBySlackThread(threadTs);
      if (!threadEntry) return;

      console.log(
        `[slack] Thread reply in ${channel} from ${user}: "${text.substring(0, 80)}..."`,
      );

      try {
        const userInfo = await this.app.client.users.info({ user });
        const senderName =
          userInfo.user?.real_name || userInfo.user?.name || user;

        await this.opencode.resumeSessionWithReply(
          threadEntry.opencode_session_id,
          senderName,
          text,
        );
      } catch (error) {
        console.error("[slack] Failed to resume session:", error);
      }
    });
  }

  async postToThread(
    channel: string,
    threadTs: string,
    text: string,
  ): Promise<string | undefined> {
    const result = await this.app.client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: text + MESSAGE_FOOTER,
    });
    return result.ts;
  }

  async startTaskThread(
    channel: string,
    jiraKey: string,
    summary: string,
  ): Promise<string> {
    const result = await this.app.client.chat.postMessage({
      channel,
      text: `🤖 *${jiraKey}: ${summary}*\n\n_The AI agent is working on this issue. Updates will be posted in this thread._`,
    });
    return result.ts!;
  }

  async sendDirectMessage(
    userId: string,
    text: string,
    sessionId: string,
  ): Promise<{ channel: string; threadTs: string }> {
    const dm = await this.app.client.conversations.open({ users: userId });
    const channel = dm.channel!.id!;

    const result = await this.app.client.chat.postMessage({
      channel,
      text: text + MESSAGE_FOOTER,
    });

    const threadTs = result.ts!;

    this.db.createSlackThread(threadTs, channel, sessionId, userId);

    return { channel, threadTs };
  }
}
