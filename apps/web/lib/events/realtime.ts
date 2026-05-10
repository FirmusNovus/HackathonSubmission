// In-memory pub/sub for SSE channels.
//
// Single Node process is fine for the current dev/demo scope — every API
// route handler that mutates a booking or order calls publishBookingChanged /
// publishOrderChanged after the DB update commits, and the SSE endpoint
// subscribes to the same emitter and pushes a fresh snapshot to its
// connected client. With multiple Node instances behind a load balancer
// you'd swap this for Redis pub/sub or postgres LISTEN/NOTIFY, but the
// publish/subscribe surface stays the same.
//
// We keep the emitter on `globalThis` so HMR doesn't strand subscribers on a
// freshly-imported emitter while publishers still hit the old one (same
// trick as `lib/db/client.ts`).

import { EventEmitter } from "node:events";

const globalForEvents = globalThis as unknown as { __firmusEmitter?: EventEmitter };

const emitter = (globalForEvents.__firmusEmitter ??= (() => {
  const e = new EventEmitter();
  // Each booking/order page may have many tabs/clients open. Default 10 is
  // too low; setting to 0 disables the warning entirely.
  e.setMaxListeners(0);
  return e;
})());

export function publishBookingChanged(bookingId: string): void {
  emitter.emit(`booking:${bookingId}`);
}

export function subscribeBookingChanged(bookingId: string, cb: () => void): () => void {
  const handler = () => cb();
  emitter.on(`booking:${bookingId}`, handler);
  return () => emitter.off(`booking:${bookingId}`, handler);
}

export function publishOrderChanged(orderId: string): void {
  emitter.emit(`order:${orderId}`);
}

export function subscribeOrderChanged(orderId: string, cb: () => void): () => void {
  const handler = () => cb();
  emitter.on(`order:${orderId}`, handler);
  return () => emitter.off(`order:${orderId}`, handler);
}
