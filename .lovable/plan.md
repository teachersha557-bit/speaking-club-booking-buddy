# Teacher Sha Speaking Club — Booking Automation Plan

Your Netlify website stays exactly as it is visually. This Lovable project becomes the private "engine room": booking records, payment checks, Google Calendar/Meet, emails, WhatsApp and your admin dashboard.

## The new flow

```text
Student fills form on Netlify  ->  engine checks 4 dates have seats, holds them 20 min,
                                   saves booking TSC-XXXXXX, creates a BCL payment link
                                   (order number = TSC-XXXXXX, RM49 + RM1 fee)
Booking page /booking/TSC-XXXXXX ->  shows real status + "Pay RM49 at BCL" (that booking's link)
Student pays at BCL             ->  BCL notifies the engine (payment-success)
Engine                          ->  re-checks the order with BCL's API (paid, RM49 item, MYR,
                                   same reference, not already processed)
                                ->  allocates all 4 dates (or flags for you if full/expired)
                                ->  creates/reuses 1 Calendar event + Meet link per Tuesday
                                ->  adds student to the 4 events (Google sends invites)
                                ->  sends ONE confirmation email from your Gmail with 4 links
Tuesday 2:00 PM                 ->  WhatsApp reminder with that Tuesday's link
After the 4th class             ->  one renewal reminder, only for continuing students
```

## Changes to your Netlify site (small, no redesign)
- Register button sends the booking to the engine instead of only Netlify Forms (Netlify Forms kept as backup copy). Adds a WhatsApp consent tick box.
- Booking page fetches the booking's real status and its own BCL payment link.
- Wording fix: "RM49 / bulan" becomes "RM49 untuk 4 kelas (bayaran sekali, bukan langganan)". Your current terms are kept.
- I'll edit the files you upload and give you back a ready-to-upload folder; you deploy it to Netlify.

Note: students will pay through a BCL payment page made for their booking, not the general "spekaing-club" form page. Payment still goes to your BCL/Bayarcash account.

## Build stages (each tested before the next)
1. **Engine and database**: students, Tuesday classes, bookings, payments, notifications, email and webhook logs. Server-side 4-Tuesday calculation (same 8 PM cutoff), 10-seat limit with safe locking, 20-min holds and expiry.
2. **BCL**: create payment links, receive notifications, verify with BCL API, duplicate protection, unmatched/late payment flagging. Test mode first.
3. **Google Calendar + Meet**: one event per Tuesday, reuse, attendees added with invites.
4. **Confirmation email** from your Gmail, sent once, logged.
5. **WhatsApp**: 2 PM reminder and renewal reminder with all safeguards; scheduled checks every few minutes.
6. **Admin dashboard** (only you can sign in): overview, classes, students, payments, notifications, resend/retry/cancel/resolve, CSV export.
7. **Netlify file update** handed back to you, then full end-to-end tests before going live.

## What you'll need to provide
- Your Netlify site files (zip) — needed at stage 7, earlier is fine.
- BCL: an API token with read + write access, and your Bayarcash portal key (shared via a secure form). Test mode turned on for testing.
- Google: connect your Google account (Calendar + Gmail) via a connect button.
- WhatsApp: a Meta Business account and a number not used in the normal WhatsApp app; two templates submitted for Meta approval (can take up to 48 hours).
- Your admin login email.

## Costs
- Lovable Cloud (database/server): usage on your Lovable plan, expected to be low.
- Google Calendar, Meet, Gmail: free (Gmail sending limit about 500/day).
- BCL: your existing fees.
- WhatsApp: charged per message by Meta; class reminder likely "utility" (cheap), renewal likely "marketing" (more expensive). Exact rates on Meta's Malaysia rate card.

## Technical details
- Lovable Cloud Postgres; capacity enforced in a single SQL function with row locks on class_sessions; unique constraints on (booking, class), payment order_number, webhook delivery, notification (type, booking, class_date), email (booking, type).
- Public endpoints: `/api/public/bookings` (create, rate-limited, validated), `/api/public/bookings/$ref` (status only, no personal data), `/api/public/bcl/webhook` (always re-verified via `GET /transactions/{order_number}` with custom User-Agent, since BCL webhooks are unsigned). CORS limited to the Netlify domain.
- Scheduled job (pg_cron) calls a protected endpoint for hold expiry, 2 PM reminders and renewal checks; idempotent.
- Admin via Lovable Cloud auth + separate user_roles table.
