import type { Booking, LawyerProfile, Message, User } from "@prisma/client";

export type PricingItem = {
  title: string;
  desc: string;
  price: number | null;
  unit: string;
};

/** A single billable line on a booking order. */
export type LineItem = {
  id: string;
  title: string;
  description?: string;
  kind: "hourly" | "fixed";
  hours?: number;
  ratePerHour?: number;
  fixedPrice?: number;
  subtotal: number; // in ETH
};

/** A concrete objective the lawyer agrees to deliver as part of this booking. */
export type Deliverable = {
  id: string;
  title: string;
  description?: string;
};

export type LawyerProfileWithUser = LawyerProfile & {
  user: User;
  pricingItems: PricingItem[];
};

export type BookingWithRelations = Booking & {
  lawyerProfile: LawyerProfile & { user: User };
  client: User;
};

export type MessageWithSender = Message & {
  sender: Pick<User, "id" | "name" | "walletAddress" | "role" | "avatarUrl">;
};
