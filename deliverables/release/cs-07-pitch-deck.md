# CS-07 · CleanSheet Pitch Deck (4 Slides)

**Owner:** `@jv-013` ([Sarvam](../../roles/04-sarvam.md))  
**Event:** Cashfree × Sarvam AI Buildathon · Bengaluru · 21 Nov 2026

---

## Slide 1 · The Problem
**Grassroots football coaches spend training time chasing ₹1,500 monthly fees on chat apps.**
- Coaches in Bengaluru and across India work faster by speaking **Hindi or Kannada** than filling English spreadsheets.
- Missed renewals trigger awkward follow-ups; unverified screenshots cause ledger errors; accidental double charges and unconfirmed refunds erode parent trust.

---

## Slide 2 · The CleanSheet Flow
**Voice command → Explicit confirmation → Verified Cashfree settlement & lifecycle.**
1. **Speak to Raz (`hi-IN` / `kn-IN`):** Coach speaks or types *"Set U12 Demo Player November fee to ₹1,500."*
2. **Preview without side effects:** Sarvam `saaras:v4` transcribes audio; `sarvam-105b` calls `prepare_fee_preview` (0 DB writes). Coach confirms explicitly.
3. **Parent Checkout & Mandate (`Cashfree PG & Subscriptions Sandbox`):** Linked parent verifies adult contact (`Secure ID OTP`), manages mandate (`Keep` / `Cancel`), and pays via hosted Cashfree Sandbox.
4. **Atomic Settlement & Scoped Refunds:** Server verifies payment once (`₹1,500` Outstanding → Collected) and supports scoped partial refunds (`₹500` refund → `₹1,000` Net Collected).

---

## Slide 3 · What Sarvam AI & Cashfree Proved
- **Sarvam AI (`saaras:v4` + `sarvam-105b` + In-Process MCP):**
  - Native Hindi & Kannada voice recognition + structured tool calling (`prepare_fee_preview`) + actor-scoped `get_fee_summary` MCP tool.
  - Bilingual Relay outreach scripts (`precharge_parent_call`, `recovery_parent_call_and_link`, `cancellation_coach_call`) strictly gated by consent.
- **Cashfree (`PG Sandbox` · `Subscriptions` · `Secure ID` · `Relay`):**
  - Server-reserved integer-paise orders, atomic idempotent payment verification, cancellation-safe mandate lifecycle, adult OTP verification, and bounded refunds.

---

## Slide 4 · Security Architecture & Roadmap
- **Security Hardening Built In:** Strict server-side token verification, default-deny `firestore.rules` (zero client writes), Fetch-Metadata + strict Origin CORS, per-IP API rate limiting, CSP + security headers, HTML/input sanitization, and secret-scanned repository history.
- **Roadmap:** Full multi-squad academy onboarding, parent WhatsApp/IVR delivery at scale, automated coach turf payouts via Cashfree Payouts, and seasonal GST receipts.
