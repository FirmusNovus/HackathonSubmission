import type { Booking, LawyerProfile, Message, User } from "@prisma/client";
import type { BookingStatus, PricingKind, VerificationStatus } from "@/lib/db/enums";

export type PricingItem = {
  title: string;
  desc: string;
  price: number | null;
  unit: string;
};

/** A single billable line on a booking invoice. */
export type LineItem = {
  id: string;
  title: string;
  description?: string;
  kind: "hourly" | "fixed";
  hours?: number;
  ratePerHour?: number;
  fixedPrice?: number;
  subtotal: number; // in tokenized EUR
};

/** A concrete objective the lawyer agrees to deliver as part of this booking. */
export type Deliverable = {
  id: string;
  title: string;
  description?: string;
};

// SQLite stores list-shaped fields as JSON-encoded strings, and the four
// removed-from-Prisma enum columns are stored as plain strings. The expanded
// shape narrows them back down to the union types used by the UI layer.
type ExpandedLawyerProfile = Omit<
  LawyerProfile,
  "specialties" | "languages" | "jurisdictions" | "tags" | "credentialDocsUrl" | "pricingKind" | "verificationStatus"
> & {
  specialties: string[];
  languages: string[];
  jurisdictions: string[];
  tags: string[];
  credentialDocsUrl: string[];
  pricingKind: PricingKind;
  verificationStatus: VerificationStatus;
};

export type LawyerProfileWithUser = ExpandedLawyerProfile & {
  user: User;
  pricingItems: PricingItem[];
};

export type BookingWithRelations = Omit<Booking, "status"> & {
  status: BookingStatus;
  lawyerProfile: ExpandedLawyerProfile & { user: User };
  client: User;
};

export type MessageWithSender = Message & {
  sender: Pick<User, "id" | "name" | "walletAddress" | "role" | "avatarUrl">;
};
