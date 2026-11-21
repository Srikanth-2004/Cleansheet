# CS-06 · CleanSheet Demo Video Script & Timeline (65s)

**Owner:** Person 1 · Frontend (`@jv-013`)  
**Target Duration:** 65 seconds (within 60–70s spec window)  
**Pre-Capture Gate:** Wait for `CS-08` release QA sign-off on the single deployed HTTPS Vercel build with `NEXT_PUBLIC_USE_FIXTURES=false`.

## Capture Setup Checklist

- [ ] Browser: Desktop Chrome (1920x1080 or 1440x900, 100% zoom, dark theme visible).
- [ ] Visible indicators: **Cashfree PG Sandbox** badge visible in header and checkout; NO `LOCAL FIXTURE MODE` banner present.
- [ ] Scenario seeded: Fresh scenario (`2026-11` starts at `₹0` Expected, `₹0` Collected, `₹0` Outstanding).
- [ ] Two browser profiles/windows ready: Coach Google account (`/coach`) and Linked Parent Google account (`/parent`).
- [ ] Audio or typed fallback verified (`hi-IN` or `kn-IN` per `CS-04` sign-off):
  - **Hindi (`hi-IN`)**: `नवंबर 2026 के लिए U12 डेमो प्लेयर की फीस 1500 रुपये सेट करें`
  - **Kannada (`kn-IN`)**: `ನವೆಂಬರ್ 2026 ಕ್ಕೆ U12 ಡೆಮೊ ಪ್ಲೇಯರ್ ಶುಲ್ಕ 1500 ರೂಪಾಯಿ ನಿಗದಿಪಡಿಸಿ`
  - *(Note: If typed fallback is used during capture, show it explicitly per `CS-06`.)*

## 65-Second Beat Timeline

| Time | Beat | Screen / Action | On-Screen Caption |
|---|---|---|---|
| `0:00–0:08` | **1. Problem & Opening State** | Coach Dashboard (`/coach`) showing `First Touch Academy · U12`, `Cashfree PG Sandbox` badge, and `₹0 / ₹0 / ₹0` totals. | *Grassroots football coaches track fees across chats and sheets. CleanSheet starts from zero in 2026-11.* |
| `0:08–0:20` | **2. Voice Command to Raz** | Coach selects Hindi or Kannada, clicks **Record Command**, speaks the ₹1,500 fee command, and clicks **Stop & Ask Raz**. | *Coach speaks in Hindi/Kannada — Sarvam `saaras:v4` + `sarvam-105b` parses the fee proposal.* |
| `0:20–0:30` | **3. Preview & Explicit Confirmation** | Raz shows the native-script transcript, `Demo Player`, `2026-11`, and `₹1,500 (150000 paise)` (`Preview Only`). Coach clicks **Confirm & Create Fee (₹1,500)**. Expected & Outstanding update to `₹1,500`. | *Preview creates zero records. Explicit coach confirmation writes ₹1,500 expected & outstanding.* |
| `0:30–0:48` | **4. Parent Cashfree Sandbox Checkout** | Switch to Linked Parent (`/parent`). See `Demo Player · U12 · ₹1,500 · Unpaid`. Click **Pay ₹1,500 via Cashfree Sandbox**, complete Cashfree PG Sandbox payment, and return to `/parent?order_id=...`. | *Linked parent opens Cashfree PG Sandbox hosted checkout for the exact stored fee.* |
| `0:48–0:58` | **5. Server Verification & Coach Refresh** | Parent screen displays `Paid · Verified` after `POST /api/orders/[id]/verify`. Switch to Coach Dashboard and click **Refresh Collections**: `Collected ₹1,500`, `Outstanding ₹0`, `Paid Fees: 1`. | *Server verifies Cashfree payment atomically and moves ₹1,500 from outstanding to collected.* |
| `0:58–1:05` | **6. End Card** | Title card: `CleanSheet · First Touch Academy U12`, deployed URL, Sarvam AI + Cashfree PG Sandbox + Firebase stack summary. | *CleanSheet — Voice-first academy fee collection, verified end-to-end.* |

## Quick Export & Trim Command

If trimming/re-encoding a screen capture with `ffmpeg` (`1080p`, H.264 MP4, AAC audio):

```bash
ffmpeg -i raw-capture.mov -t 65 -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -movflags +faststart deliverables/release/cleansheet-demo.mp4
```
