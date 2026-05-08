// Owner spec: 001-verified-legal-engagement.
// Server-side role guards. Throws redirects on mismatch; 404 the page on miss.

import { notFound, redirect } from 'next/navigation';
import { getSessionWithRoles } from './session';

export async function requireClient() {
  const s = await getSessionWithRoles();
  if (!s) redirect('/connect');
  if (!s.isClient) notFound();
  return s;
}

export async function requireLawyer() {
  const s = await getSessionWithRoles();
  if (!s) redirect('/connect');
  if (!s.isLawyer) notFound();
  return s;
}

export async function requireOperator() {
  const s = await getSessionWithRoles();
  if (!s) redirect('/connect');
  if (!s.isOperator) notFound();
  return s;
}
