# Teacher Sha Speaking Club — Netlify deployment guide

This project is the **booking engine + private admin dashboard**. It does **not**
replace your public website.

```text
teachershaspeaking.netlify.app   (your existing public site — unchanged design)
        │  registration form  ──POST──►  ENGINE/api/public/bookings
        │  /booking/TSC-XXXXXX ──GET───►  ENGINE/api/public/bookings/TSC-XXXXXX
        ▼
   Student pays RM49 at BCL  ──notification──►  ENGINE/api/public/bcl/webhook
                                               (always re-checked with the BCL API)
ENGINE  = this project on a SECOND Netlify site, e.g. teachersha-booking.netlify.app
        → Supabase database (bookings, seats, payments, logs)
        → Google Calendar: one event + one Meet link per Tuesday, student added as guest
        → Gmail: one confirmation email with the four dated Meet links
        → WhatsApp: Tue 2 PM class reminder, Wed 10 AM renewal reminder (off until you switch it on)
        → /admin dashboard (only teachersha557@gmail.com)
```

Students never see the engine site. They keep using your existing website and BCL.

---

## What has been built and tested here vs. what you must test

| Area | Status |
|---|---|
| Four-Tuesday dates, 8 PM cut-off, Malaysia time | Unit-tested |
| 10 seats per Tuesday, 20-min holds, no overselling, no overlapping packages, late payment after expiry → flagged | Tested on a real PostgreSQL database |
| Public API validation, CORS, cron protection, webhook signature checks | Tested on a running build |
| Netlify build (`npm install` + `npm run build`) | Tested from a clean copy |
| BCL API, Google Calendar/Meet/Gmail, WhatsApp | **Code written, NOT yet run against the real services.** These need your accounts. Follow the test checklist at the end before going live. |

> Important about BCL: this environment could not open BCL's documentation or your
> BCL form. The BCL calls (`POST /v1/payment-link`, `GET /v1/transactions/{order_number}`
> and `GET /v1/transaction/{order_number}` in test mode) were written in the earlier
> Lovable build. **Confirm them in BCL test mode before going live** (step 7).

---

## Monthly costs

| Service | Cost |
|---|---|
| Netlify (engine site) | Free plan is normally enough (about 4,500 scheduled runs/month + bookings). |
| Supabase | Free plan (500 MB). The 10-minute job keeps the project from being paused. |
| Google Calendar, Meet, Gmail API | Free. Gmail sends up to ~500 emails/day from a personal account. |
| BCL | Your existing BCL/Bayarcash fees only. |
| WhatsApp (Meta) | Charged per delivered template message. Malaysia, approximately: **utility ≈ US$0.014** (class reminder), **marketing ≈ US$0.086** (renewal reminder). Check Meta's current rate card. Example: 10 students × 4 classes = 40 reminders ≈ US$0.56 + a few renewals. |

---

## Step 1 — Database (Supabase)

1. Create a free project at https://supabase.com (region: Singapore).
2. Dashboard → **SQL Editor** → paste the whole of [`supabase/setup.sql`](supabase/setup.sql) → **Run**.
3. Dashboard → **Project Settings → API**: copy the Project URL, the publishable/anon key and the
   **service_role / secret key** (keep this secret).
4. Dashboard → **Authentication → URL Configuration**:
   - Site URL: `https://YOUR-ENGINE-SITE.netlify.app`
   - Redirect URLs: add `https://YOUR-ENGINE-SITE.netlify.app/auth`
5. Dashboard → **Authentication → Email Templates → Magic Link**: make sure the template contains
   `{{ .ConfirmationURL }}` (the link) and optionally `{{ .Token }}` (a 6-digit code you can type in).
6. The admin email is `teachersha557@gmail.com`. To add another admin later, run in the SQL editor:
   `insert into public.admin_emails values ('other@gmail.com');`

> Already using Lovable Cloud? The same SQL is in `drizzle/migrations/0003_netlify_engine.sql`
> and Lovable applies it automatically. To host on Netlify you still need that database's
> **service role key**; if Lovable does not give it to you, use a new Supabase project as above.

## Step 2 — Create the engine site on Netlify

1. Netlify → **Add new site → Import an existing project → GitHub** →
   `teachersha557-bit/speaking-club-booking-buddy`, branch `main` (after merging this work).
2. Build settings come from `netlify.toml` (build `npm run build`, publish `dist`). Leave them.
3. **Site configuration → Environment variables**: add everything from [`.env.example`](.env.example)
   that you have so far. Minimum to start:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
4. Deploy. Rename the site (e.g. `teachersha-booking`).
5. Open `https://YOUR-ENGINE-SITE.netlify.app/auth`, sign in with teachersha557@gmail.com,
   open **Setup** in the dashboard to see what is still missing.
6. Netlify → **Functions**: you should see `job-payments`, `job-class-reminders`,
   `job-renewal-reminders` marked *Scheduled*.

After changing any environment variable, redeploy (Deploys → Trigger deploy).

## Step 3 — Google Calendar, Meet and Gmail

The system uses **your own Google account** so the events, Meet links and emails come from you.

1. https://console.cloud.google.com → create a project "Teacher Sha Booking".
2. **APIs & Services → Library**: enable **Google Calendar API** and **Gmail API**.
3. **OAuth consent screen**: User type *External*, add your email as a test user,
   scopes: `.../auth/calendar.events` and `.../auth/gmail.send`.
   Then click **Publish app → In production**. (In *Testing* mode Google expires the
   token after 7 days. You don't need Google verification for your own account —
   you'll just see an "unverified app" warning once; click *Advanced → continue*.)
4. **Credentials → Create credentials → OAuth client ID** → *Web application*.
   Authorized redirect URI: `https://developers.google.com/oauthplayground`.
   Copy the Client ID and Client secret.
5. Go to https://developers.google.com/oauthplayground → ⚙️ → tick *Use your own OAuth credentials* → paste them.
   In "Input your own scopes" enter:
   `https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send`
   → **Authorize APIs** (sign in as teachersha557@gmail.com) → **Exchange authorization code for tokens**.
   Copy the **Refresh token**.
6. In Netlify set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
   (and optionally `EMAIL_FROM`). Redeploy.

How it behaves with a personal Gmail account:
- One event per Tuesday (8–9 PM Asia/Kuala_Lumpur) is created the first time someone pays for that
  Tuesday; Google generates its Meet link. Every later student for that Tuesday is added to the same event.
- Students get a normal Google Calendar invitation from your Gmail. Guests cannot see each other.
- Meet links are only saved once Google returns them; the email waits until all four exist.
- Students who aren't signed in to Google may have to "Ask to join" — you admit them in Meet.
  To let anyone with the link join directly, change your Meet *Host controls → Quick access* setting.

## Step 4 — BCL payments

1. In your BCL dashboard create an **API token** and copy your **Bayarcash portal key**.
2. Set `BCL_API_TOKEN`, `BCL_PORTAL_KEY`, keep `BCL_TEST_MODE=true` while testing.
3. Set the BCL **callback / webhook URL** to
   `https://YOUR-ENGINE-SITE.netlify.app/api/public/bcl/webhook`
   (add `?key=...` if you set `BCL_WEBHOOK_KEY`).

How payments are matched to bookings:

- **Payment link mode (default, safest):** for each booking the engine asks BCL to create a payment
  link whose **order number is the booking reference** (TSC-XXXXXX), with the student's name/email
  pre-filled. Money still goes to your BCL/Bayarcash account. Matching is exact and automatic.
- **BCL form mode (fallback):** if the BCL API keys are missing, link creation fails, or you set
  `BCL_PAYMENT_MODE=form`, students are sent to your existing form
  `https://teachersha.bcl.my/form/spekaing-club`. In this case **add a required custom field
  "Booking Reference"** to that form; the booking page tells students to type their TSC-XXXXXX there.
  When BCL notifies the engine, it looks for the TSC-XXXXXX reference in the notification and then
  verifies the payment with the BCL API. Anything it can't match appears in **Admin → Payments →
  Needs attention**, where you enter the booking reference and BCL order number; BCL still has to
  confirm the amount, MYR and paid status before the booking is confirmed.

Every payment is confirmed only after the engine itself asks BCL and checks: paid status,
RM49.00 subtotal, MYR, the order/booking reference, the payer email matches the booking
(or you confirm identity manually), and that the BCL order hasn't already been used.
A browser redirect or a webhook alone never confirms a booking.

## Step 5 — Connect your existing website (small, no redesign)

Add one line before `</body>` on the public site's pages (index and booking page):

```html
<script src="https://YOUR-ENGINE-SITE.netlify.app/tsc-booking.js" defer></script>
```

**Registration form** — keep your form exactly as it is and add (adjust the names on the right to
your form's input `name`s):

```html
<script>
  document.addEventListener("DOMContentLoaded", function () {
    TSC.attachForm(document.querySelector("form[name='daftar']"), {
      fields: { name: "nama", email: "email", whatsapp: "whatsapp", start: "tarikh_mula",
                whatsapp_consent: "whatsapp_consent", reference: "rujukan" },
      keepNetlifySubmit: true   // also keeps a copy in Netlify Forms, as before
    });
  });
</script>
```

- If your page already generates a TSC-XXXXXX reference, put it in the `reference` field and the
  engine will use it (if it's already taken, the engine issues a new one and returns it).
- `start` accepts `2026-11-10` or `20261110`.
- After a successful booking the student is sent to your existing URL
  `/booking/TSC-XXXXXX?s=YYYYMMDD`.
- Add a WhatsApp consent tick box to the form (e.g. *"Saya setuju menerima peringatan kelas melalui
  WhatsApp"*). Without consent no WhatsApp messages are sent to that student.

**Booking page** — where you want the live status / Pay button to appear, add:

```html
<div data-tsc-status></div>
```

It shows the four Tuesday dates, a 20-minute countdown, the **Bayar RM49 di BCL** button for that
booking, and changes to "confirmed" automatically after payment is verified. Style it with your own
CSS using the `tsc-*` class names if you like.

Other building blocks: `TSC.getAvailability()` (seats left per Tuesday), `TSC.createBooking({...})`,
`TSC.getBooking(ref)`.

**Wording to update on the public site** (requirement: no "monthly"/subscription wording):

- RM49 covers four consecutive Tuesday classes. Payment is one-time; there is no automatic subscription.
- All four dates are reserved together. Each Tuesday has a different Google Meet link.
- Missing a class means forfeiting that class — no carry-forward, replacement class or refund for student absence.
- A new RM49 payment is required for another four-class package. Maximum 10 students per Tuesday.

## Step 6 — WhatsApp (Meta Cloud API)

1. Meta Business account → https://developers.facebook.com → create an app (type *Business*) → add **WhatsApp**.
2. Add and verify a phone number that is **not** used in the normal WhatsApp app.
3. Business Settings → System users → create one, give it the app + WhatsApp account, generate a
   **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Copy the **Phone number ID**, the token, and the app's **App secret** (App settings → Basic).
5. WhatsApp → Configuration → Webhook: URL `https://YOUR-ENGINE-SITE.netlify.app/api/public/whatsapp/webhook`,
   verify token = your `WHATSAPP_VERIFY_TOKEN`; subscribe to `messages`.
6. Create two templates (language *English*, code `en`) and wait for approval (up to 48 h):

   **`class_reminder`** — category **Utility**
   ```
   Hi {{1}}! 😊

   Just a reminder that your Teacher Sha Speaking Club class is TODAY!

   📅 Date: {{2}}
   ⏰ Time: 8:00 PM–9:00 PM (Malaysia time)
   💻 Google Meet: {{3}}

   See you tonight!
   ```
   **`renewal_reminder`** — Meta will most likely classify this as **Marketing** (it invites a new purchase)
   ```
   Hi {{1}}! 😊

   Thank you for joining Teacher Sha Speaking Club!

   Your 4-class package has now ended. If you'd like to continue practising English with us, you can book your next 4 Tuesday sessions for RM49 here:

   {{2}}

   Hope to see you again!
   ```
7. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_VERIFY_TOKEN`. Leave `WHATSAPP_LIVE=false` until you've tested with your own number,
   then set it to `true` and redeploy.

Rules built in: only paid, confirmed, consenting, active students; the correct Tuesday's link;
at most one message per student per class / per package (safe if a job runs twice); students who
reply STOP are opted out; renewal reminders go out on the Wednesday at 10 AM after the 4th class
only if the student hasn't renewed, isn't inactive, and had no gap of a month or more between packages.

## Step 7 — Test before going live (BCL test mode)

Use the admin dashboard to watch each step.

1. Book a Tuesday on the public site with your own email/phone → booking appears as *held*; the
   booking page shows a countdown and Pay button.
2. Pay in BCL test mode → within seconds (webhook) or ≤10 min (scheduled check) it becomes
   *confirmed*; Payments shows *verified*.
3. Check: four Calendar events (one per Tuesday) each with a **different** Meet link; you are a guest
   on all four; one confirmation email with four dated links.
4. Book a second test student for the same start date → same four events/links are reused.
5. Make a booking and don't pay → after 20 minutes it shows *expired* and the seat is released.
6. Failed payment → booking stays unpaid. Repeat the same BCL notification → nothing duplicated.
7. Pay after the hold expired when the class is full → booking shows *needs_resolution*, no links sent.
8. Use the BCL form with a reference typed in → confirmed, or appears under *Needs attention*.
9. Dashboard → Students → renewal column shows *eligible* / *renewed* / *gap of a month or more* as expected.
10. With `WHATSAPP_LIVE=true`, use your own booking on a Tuesday to receive the 2 PM reminder.
11. Then set `BCL_TEST_MODE=false`, redeploy, make one real RM49 payment, and you're live.

## Environment variable reference

See [`.env.example`](.env.example). Secrets are only ever read on the server.

## Troubleshooting

- **Admin says "not an admin account"** — sign in with teachersha557@gmail.com, or add your email to `admin_emails` (Step 1.6) and sign in again.
- **Calendar: "Google Calendar is not connected"** — set the three `GOOGLE_*` variables and redeploy.
- **Google `invalid_grant`** — the refresh token expired or was revoked (usually because the consent screen was still in *Testing*). Publish it and create a new refresh token.
- **Bookings fail from the public site with a CORS error** — add the exact site address to `ALLOWED_ORIGINS`.
- **Nothing happens every 10 minutes** — check `CRON_SECRET` is set and Netlify → Functions → `job-payments` logs.
