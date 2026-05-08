-- Phase 4 / Group F refinement.
--
-- Track the most recently *anchored* transcript root separately from the
-- off-chain pending root. Originally added to drive a "skip the anchor
-- tx if root hasn't advanced" check that paired with every milestone
-- state-change tx in V1.
--
-- V2 (2026-05-07) removed the paired-anchor pattern entirely — only
-- close / dispute / escalate anchor on chain, and they pass the root
-- inline. The indexer still updates this column on every
-- TranscriptAnchored event for completeness, but no V2 code reads it
-- anymore. Kept to avoid a destructive schema migration; safe to drop
-- in a future schema cleanup pass.

ALTER TABLE engagement_off_chain ADD COLUMN last_anchored_root TEXT;
