import type { Actor } from './billing.js';

export type SubscriptionStatus = 'authorising' | 'active' | 'cancel_pending' | 'cancelled' | 'needs_review';
export type CycleStatus = 'awaiting_decision' | 'decision_recorded' | 'charge_scheduled' | 'processing'
  | 'paid' | 'failed' | 'recovery_available' | 'closed' | 'needs_review';
export type ParentDecision = 'keep' | 'cancel_subscription';
export type ContactStatus = 'unverified' | 'pending' | 'verified' | 'blocked';
export type OutreachConsent = 'granted' | 'withheld';

export interface VerifiedSubscriptionCancellation {
  eventKey: string;
  playerId: string;
  providerSubscriptionId: string;
  providerStatus: 'CANCELLED' | 'CUSTOMER_CANCELLED';
  observedAt: string;
}

export interface ParentBilling {
  subscription: { id: string; status: SubscriptionStatus; nextDueAt: string | null } | null;
  cycle: { id: string; period: string; amountPaise: number; dueAt: string; status: CycleStatus; recoveryUrl: string | null } | null;
  contactStatus: ContactStatus;
  outreachConsent: OutreachConsent;
}

export interface BillingStore {
  readParentBilling(actor: Actor): Promise<ParentBilling>;
  recordOutreachConsent(actor: Actor, granted: boolean, consentVersion: string): Promise<OutreachConsent>;
  recordParentDecision(actor: Actor, cycleId: string, decision: ParentDecision): Promise<{
    cycleStatus: CycleStatus;
    subscriptionStatus: SubscriptionStatus;
  }>;
  applyVerifiedCancellation(event: VerifiedSubscriptionCancellation): Promise<'applied' | 'already_applied'>;
}
