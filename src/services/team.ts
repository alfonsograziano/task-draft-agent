import { z } from "zod";
import defaultMembers from "../../config/team-members.json" with { type: "json" };

export const TeamMemberSchema = z.object({
  name: z.string(),
  role: z.string(),
  slack_user_id: z.string(),
  areas: z.array(z.string()),
});

export const TeamMembersSchema = z.array(TeamMemberSchema);

export type TeamMember = z.infer<typeof TeamMemberSchema>;

const teamMembers: TeamMember[] = TeamMembersSchema.parse(defaultMembers);

export function getTeamMembers(): TeamMember[] {
  return teamMembers;
}

export function findTeamMemberBySlackId(
  slackUserId: string,
): TeamMember | undefined {
  return teamMembers.find((m) => m.slack_user_id === slackUserId);
}
