import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";

export const runtime = "nodejs";

interface InboxRow {
  request_id: number;
  request_status: "pending" | "declined" | "accepted" | "withdrawn";
  request_created_at: number;
  matter_id: number;
  description: string;
  target_jurisdiction: string;
  target_practice_area: string;
  client_address: string;
  client_disclosed_attrs: string | null;
  proposal_count: number;
  head_proposal_id: number | null;
  head_proposer_address: string | null;
  head_amount_wei: string | null;
}

/**
 * Lawyer-side inbox. Returns the engagement requests addressed to the
 * SIWE-bound wallet. No filter by attested_role — anyone could have a request
 * sent to them in theory; the chain check on /request enforces verified_lawyer
 * before a request can land here.
 *
 * For each request we surface only what FR-029 permits the lawyer to see about
 * the client: their wallet address + the country/age-over-18 disclosure
 * subset. Names, document numbers, etc. were never persisted past finalize.
 */
export async function GET() {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const rows = getDb()
    .prepare(
      `SELECT
         r.id              AS request_id,
         r.status          AS request_status,
         r.created_at      AS request_created_at,
         r.client_address  AS client_address,
         m.id              AS matter_id,
         m.description     AS description,
         m.target_jurisdiction,
         m.target_practice_area,
         vu.disclosed_attrs AS client_disclosed_attrs,
         (SELECT COUNT(*) FROM engagement_proposals p WHERE p.request_id = r.id) AS proposal_count,
         (SELECT p.id FROM engagement_proposals p
            WHERE p.request_id = r.id AND p.superseded_by IS NULL
            ORDER BY p.id DESC LIMIT 1) AS head_proposal_id,
         (SELECT p.proposer_address FROM engagement_proposals p
            WHERE p.id = (SELECT id FROM engagement_proposals WHERE request_id = r.id AND superseded_by IS NULL ORDER BY id DESC LIMIT 1)
         ) AS head_proposer_address,
         (SELECT p.amount_wei FROM engagement_proposals p
            WHERE p.id = (SELECT id FROM engagement_proposals WHERE request_id = r.id AND superseded_by IS NULL ORDER BY id DESC LIMIT 1)
         ) AS head_amount_wei
       FROM engagement_requests r
       JOIN matters m ON m.id = r.matter_id
       LEFT JOIN verified_users vu
              ON lower(vu.eth_address) = lower(r.client_address)
             AND vu.attested_role = 'client'
       WHERE lower(r.lawyer_address) = lower(?)
       ORDER BY r.created_at DESC`
    )
    .all(address) as InboxRow[];

  const requests = rows.map((row) => {
    const disclosed = row.client_disclosed_attrs
      ? (JSON.parse(row.client_disclosed_attrs) as {
          country_of_residence?: string;
          age_equal_or_over_18?: boolean;
        })
      : {};
    return {
      request_id: row.request_id,
      status: row.request_status,
      created_at: row.request_created_at,
      matter: {
        id: row.matter_id,
        description: row.description,
        target_jurisdiction: row.target_jurisdiction,
        target_practice_area: row.target_practice_area,
      },
      client: {
        address: row.client_address,
        country_of_residence: disclosed.country_of_residence ?? null,
        age_equal_or_over_18: disclosed.age_equal_or_over_18 ?? null,
      },
      head_proposal:
        row.head_proposal_id !== null
          ? {
              id: row.head_proposal_id,
              proposer_address: row.head_proposer_address,
              amount_wei: row.head_amount_wei,
            }
          : null,
      proposal_count: row.proposal_count,
    };
  });

  return NextResponse.json({ requests });
}
