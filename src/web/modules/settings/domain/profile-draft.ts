import type { UserProfile } from "../../../../shared/types.js";
import { formatHandles } from "@/modules/settings/domain/profile-handles";

export type ProfileField = "name" | "email" | "handles" | "role" | "brief";

export type ProfileDraft = Record<ProfileField, string>;

export function toProfileDraft(profile: UserProfile): ProfileDraft {
  return {
    name: profile.name ?? "",
    email: profile.email ?? "",
    handles: formatHandles(profile.handles ?? []),
    role: profile.role ?? "",
    brief: profile.brief ?? "",
  };
}
