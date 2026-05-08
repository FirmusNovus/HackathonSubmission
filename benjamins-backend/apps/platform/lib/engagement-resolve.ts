/**
 * Shared lookup: given a SIWE-bound address + an engagement_request id,
 * resolve to the on-chain engagement_id, the off-chain row, and the caller's
 * role (client | lawyer | not-a-party). All Group F milestone routes start
 * with this same gate, so it lives once here.
 */
import type Database from "better-sqlite3";

import { getEngagementByRequest, type EngagementOffChain } from "@/lib/messaging/engagement-keys";

export type Role = "client" | "lawyer" | "none";

export interface ResolvedEngagement {
  engagement: EngagementOffChain;
  role: Role;
}

export function resolveEngagement(
  db: Database.Database,
  requestId: number,
  callerAddress: string
): ResolvedEngagement | null {
  const eng = getEngagementByRequest(db, requestId);
  if (!eng) return null;
  const lower = callerAddress.toLowerCase();
  let role: Role = "none";
  if (eng.client_address.toLowerCase() === lower) role = "client";
  else if (eng.lawyer_address.toLowerCase() === lower) role = "lawyer";
  return { engagement: eng, role };
}
