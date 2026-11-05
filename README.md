# Speaking Club Booking Buddy

TEACHER SHA SPEAKING CLUB — COMPLETE BOOKING & AUTOMATION SYSTEM



1. PROJECT OBJECTIVE



I have an existing Teacher Sha Speaking Club website that I am very happy with.



Main website:

https://teachershaspeaking.netlify.app/



I want to preserve my existing website and booking experience while building a reliable automated booking, payment verification, Google Calendar, Google Meet, email and WhatsApp notification system.



CRITICAL INSTRUCTION: DO NOT REDESIGN OR REBUILD MY EXISTING WEBSITE.



I want to keep the existing website's:



- Design and branding.

- Layout and sections.

- Colours and typography.

- Images and content.

- Mobile responsiveness.

- Existing booking page and booking reference structure.



The existing Netlify website must remain the main public-facing website students visit.



This project is primarily about connecting and automating my existing booking system, not creating another website.



Before changing anything, inspect the existing website, its booking flow, current source code and integrations. Explain the proposed architecture and any changes required before implementing them.



Do not delete, overwrite or disconnect the existing Netlify website.



---



2. EXISTING BOOKING FLOW — MUST BE PRESERVED



My existing booking system has two stages.



Stage A: Netlify booking page



Main website:

https://teachershaspeaking.netlify.app/



Example existing booking URL:



https://teachershaspeaking.netlify.app/booking/TSC-A48D85?s=20261110



The URL contains:



- Booking reference: TSC-A48D85

- Starting Tuesday: 20261110



This is an example only.



The booking page already generates a unique booking reference and uses the selected starting date.



Preserve this booking reference and date structure.



Do not create a competing booking system or unnecessary second public booking page.



Stage B: Existing BCL payment form



My actual payment form:



https://teachersha.bcl.my/form/spekaing-club



This BCL form MUST remain my payment method.



The existing flow is:



1. Student registers through the existing Netlify booking page.

2. Student receives a unique booking reference.

3. Student proceeds to the existing BCL payment form.

4. Student pays RM49.

5. The system receives payment information from BCL.

6. The system independently verifies the payment.

7. The original booking is confirmed.

8. All automation starts.



Do not replace BCL with Stripe, ToyyibPay or another payment provider.



Matching BCL payments to Netlify bookings



This is a critical integration requirement.



The system must match each successful BCL payment to the exact Netlify booking.



Inspect the existing BCL form configuration and official API documentation.



Determine whether the booking reference can be passed through a supported custom field or another supported mechanism.



Do not invent URL parameters, API endpoints or webhook payload fields.



If automatic pre-filling is not supported, recommend the safest alternative, such as a required Booking Reference custom field in the existing BCL form.



Use BCL's actual supported webhook or payment notification mechanism.



Independently verify each transaction through the BCL API before confirming a booking.



Verify:



- Booking reference.

- Student identity.

- Amount: RM49.

- Currency: MYR.

- Successful paid status.

- BCL transaction/order reference.

- No duplicate processing.



Never confirm a booking based only on a browser redirect, payment success page or unverified webhook.



Store API credentials securely on the backend. Never expose them in frontend code.



---



3. CLASS SCHEDULE AND PACKAGE RULES



Teacher Sha Speaking Club operates:



- Every Tuesday.

- 8:00 PM–9:00 PM.

- Timezone: Asia/Kuala_Lumpur.

- Online through Google Meet.

- Price: RM49.

- Package: Exactly FOUR consecutive Tuesday classes.

- Maximum: 10 paid students per individual Tuesday.



RM49 is a one-time payment for four classes.



It is NOT a recurring subscription or automatic monthly card charge.



Students select an eligible Tuesday as their starting date.



The system automatically calculates four consecutive Tuesdays.



Example:



Starting date: Tuesday 10 November 2026.



The package includes:



1. Tuesday 10 November 2026.

2. Tuesday 17 November 2026.

3. Tuesday 24 November 2026.

4. Tuesday 1 December 2026.



These are examples only.



Always calculate dates dynamically from the selected eligible Tuesday and current date.



Do not hardcode class dates.



Students must book all four dates together.



A student must make another RM49 payment to reserve another four-class package.



Booking terms



Display these policies clearly:



- RM49 covers four consecutive Tuesday classes.

- Payment is one-time.

- There is no automatic subscription.

- All four dates are reserved together.

- Each Tuesday has a different Google Meet link.

- Missing a class means forfeiting that class.

- No carry-forward, replacement class or refund for student absence.

- A new RM49 payment is required for another four-class package.

- Maximum 10 students per Tuesday.



Remove outdated references to automatic monthly card charges or a single recurring Meet link if they exist.



---



4. CAPACITY MANAGEMENT



Every Tuesday has a maximum capacity of 10 confirmed paid students.



The system must:



- Check capacity for all four selected dates before accepting a booking.

- Reserve all four dates together.

- Prevent duplicate reservations.

- Prevent overselling.

- Count only confirmed paid students towards final paid capacity.

- Support temporary pending reservations for up to 20 minutes during payment.

- Release expired unpaid reservations.

- Use concurrency-safe locking or database transactions.



If a student pays after their temporary reservation expires:



- Recheck all four dates.

- Do not oversell.

- Flag the payment for administrator resolution if the four dates can no longer be allocated.

- Do not send Meet links or confirm an unallocated booking.



A booking must not be partially confirmed.



All four dates must be successfully allocated before confirmation.



---



5. GOOGLE CALENDAR AND GOOGLE MEET



This is one of the most important requirements.



I need a DIFFERENT Google Meet link for EVERY Tuesday.



Example:



- 10 November → Meet Link A.

- 17 November → Meet Link B.

- 24 November → Meet Link C.

- 1 December → Meet Link D.



All paid students attending the same Tuesday share that Tuesday's link.



Do NOT generate a separate Meet link for each student.



Do NOT use the same Meet link for all four Tuesdays.



Automatic event creation



For every Tuesday class:



1. Create one Google Calendar event.

2. Set the event time to 8:00 PM–9:00 PM Malaysia time.

3. Generate a Google Meet conference link for that event.

4. Save the Calendar event ID and Meet link in the database.

5. Reuse the same event and link for every student attending that date.



If the event already exists, reuse it. Never create duplicate events for the same class date.



Automatically add student emails



After payment verification and successful allocation:



- Add the student's email as an attendee to all four relevant Google Calendar events.

- Send Google Calendar invitations where supported.

- Avoid adding the same attendee twice.

- If the student renews, add them to their new four class dates.

- Do not add students to dates they have not booked.



Use the official Google Calendar API and Google Meet conference creation functionality where supported.



Do not claim a Meet link has been created until Google confirms it.



If Google permissions or personal Gmail restrictions prevent a particular action, explain the limitation and propose a working alternative.



---



6. AUTOMATIC CONFIRMATION EMAIL



After successful BCL payment verification and successful allocation of all four dates, send ONE confirmation email.



The email must contain:



- Student's name.

- Confirmation of successful RM49 payment.

- Booking reference.

- Four confirmed Tuesday dates.

- Class time: 8:00 PM–9:00 PM Malaysia time.

- Four separate Google Meet links.

- Each link clearly labelled with its corresponding Tuesday date.

- Booking policies.

- A note explaining that each Tuesday has its own unique Meet link.



Example layout:



Your Teacher Sha Speaking Club Booking Is Confirmed!



Booking Reference: [Reference]



Your four classes:



1. [Tuesday Date] — [Google Meet Link]

2. [Tuesday Date] — [Google Meet Link]

3. [Tuesday Date] — [Google Meet Link]

4. [Tuesday Date] — [Google Meet Link]



Class time: Every Tuesday, 8 PM–9 PM (Malaysia time).



Please use the correct link for each class.



Do not send the confirmation email before payment verification and successful allocation.



Record email status and prevent duplicate confirmation emails.



Google Calendar invitations may be sent separately, but avoid unnecessary duplicate confirmation messages.



---



7. WHATSAPP BUSINESS CLOUD API INTEGRATION



Integrate Meta WhatsApp Business Cloud API directly where possible.



I only want TWO types of automatic WhatsApp notifications.



Do not add marketing broadcasts, daily messages or unrelated notifications.



Students must provide their WhatsApp number and appropriate consent during booking.



Store numbers in international format, including Malaysia's +60 country code.



Only verified paid students should receive class reminders.



NOTIFICATION A: SIX-HOUR CLASS REMINDER



Class time: Tuesday, 8 PM–9 PM.



Send the reminder at exactly:



Tuesday, 2:00 PM Malaysia time.



This is six hours before class.



For each Tuesday:



1. Identify students with confirmed paid bookings for that specific date.

2. Retrieve that date's unique Google Meet link.

3. Send one WhatsApp reminder to each eligible student.

4. Exclude unpaid, cancelled, expired or unbooked students.

5. Record the result.



Message template:



"Hi [Student Name]! 😊



Just a reminder that your Teacher Sha Speaking Club class is TODAY!



📅 Date: [Class Date]

⏰ Time: 8:00 PM–9:00 PM (Malaysia time)

💻 Google Meet: [Correct Meet Link]



See you tonight!"



Important:



- Send at 2 PM, exactly six hours before class.

- Use the correct Tuesday's link.

- All students booked for the same Tuesday receive the same link.

- Do not send a link belonging to another Tuesday.

- Do not send duplicate reminders if an automation runs more than once.



NOTIFICATION B: RENEWAL REMINDER FOR CURRENT, CONTINUING STUDENTS ONLY



This rule is extremely important.



I DO NOT want renewal reminders sent to former students or people who have stopped attending for a long time.



The reminder is only for current students who have been continuing their classes.



Eligibility rules



A student may receive a renewal reminder only if:



1. They have completed their latest four-class package.

2. They have a continuous booking history as a current student.

3. They have not had a gap of one month or more between consecutive packages.

4. They have not successfully paid for another four-class package.

5. They have not opted out of WhatsApp notifications.

6. They are not marked inactive.



After their fourth and final class:



- Check their booking history.

- Check whether they have renewed.

- Check whether they meet the current-student continuity rule.

- If eligible and not renewed, send ONE renewal reminder.

- If they have already renewed, send nothing.

- If they have been inactive for one month or more, send nothing.



Use actual booking and package dates to determine continuity.



Do not use the last WhatsApp message date to determine whether someone is an active student.



A new booking after an inactivity gap must not automatically revive an old package's pending renewal reminder.



Renewal reminder message



"Hi [Student Name]! 😊



Thank you for joining Teacher Sha Speaking Club!



Your 4-class package has now ended. If you'd like to continue practising English with us, you can book your next 4 Tuesday sessions for RM49 here:



[Existing Netlify Booking Link]



Hope to see you again!"



Renewal reminder safeguards



- Send only once per eligible completed package.

- Never send repeated reminders for the same package.

- Cancel a pending reminder if payment for the next package is verified before sending.

- Do not send reminders to former students.

- Do not send reminders after an inactivity gap of one month or more.

- Do not send reminders to students who have renewed.

- Use the existing Netlify booking page as the renewal destination.



WhatsApp template and cost considerations



Use approved Meta message templates where required.



The class reminder and renewal reminder may have different Meta message classifications and prices.



Do not assume that both are utility messages.



Explain the required Meta Business account setup, phone number registration, API permissions, template approval and estimated message charges.



Do not claim WhatsApp integration is live until it has been connected and tested.



---



8. DATABASE AND BOOKING RECORDS



Use a reliable database, preferably Supabase if appropriate.



Before creating a new database, inspect whether my existing Netlify project already uses one.



The database should manage:



Students



- Student ID.

- Name.

- Email.

- WhatsApp number.

- WhatsApp consent.

- Created date.

- Active/inactive status.



Class sessions



- Class ID.

- Tuesday date.

- Start and end time.

- Timezone.

- Capacity.

- Confirmed paid count.

- Google Calendar event ID.

- Google Meet link.

- Event status.



Bookings



- Booking ID.

- Unique booking reference.

- Student ID.

- Starting Tuesday.

- Four reserved class dates.

- Package price.

- Payment status.

- Booking status.

- Creation date.

- Confirmation date.



Payments



- BCL order reference.

- Booking reference.

- Amount.

- Currency.

- Payment status.

- Verification result.

- Verification timestamp.

- Raw event reference or safely stored audit data.



Notifications



- Student ID.

- Booking reference.

- Notification type.

- Class date.

- Scheduled time.

- Sent time.

- WhatsApp number.

- Message status.

- Provider message ID.

- Error details.

- Retry status.



Email logs



- Booking ID.

- Recipient.

- Email type.

- Send status.

- Timestamp.



Webhook logs



- Event type.

- BCL transaction reference.

- Booking reference.

- Processing status.

- Timestamp.

- Error details.



Prevent duplicate webhook processing and duplicate notification sending.



Store only the personal information needed to operate the booking system.



---



9. PRIVATE ADMIN DASHBOARD



Create a secure administrator dashboard for Teacher Sha.



Only the administrator should be able to access it.



Overview



Show:



- Upcoming Tuesday classes.

- Total confirmed paid students.

- Remaining seats for each date.

- Active student count.

- Pending payment verification.

- Total bookings.

- Revenue.

- Failed integrations.

- Pending renewal reminders.



Class management



For each Tuesday, show:



- Date.

- Time.

- Paid student count out of 10.

- Remaining capacity.

- Student list.

- Google Meet link.

- Calendar event ID.

- Event creation status.

- WhatsApp reminder status.



Student management



Show:



- Student name.

- Email.

- WhatsApp number.

- Booking reference.

- Four booked dates.

- Payment status.

- Package history.

- Current/inactive status.

- Renewal eligibility.

- WhatsApp consent.



Payment management



Show:



- BCL order reference.

- Booking reference.

- Student.

- Amount.

- Payment status.

- Verification status.

- Unmatched payments.



Notification management



Show:



- Scheduled class reminders.

- Sent reminders.

- Failed reminders.

- Renewal reminder eligibility.

- Renewal reminders already sent.

- Error logs.



Admin actions



Allow the administrator to:



- Search bookings and students.

- View all four Meet links for a booking.

- Resend confirmation emails safely.

- Retry failed WhatsApp messages safely.

- View and resolve unmatched payments.

- Cancel a booking.

- Flag payments requiring manual resolution.

- Export booking and payment records.



Do not expose other students' personal details to students.



---



10. SECURITY AND RELIABILITY



- Secure all backend endpoints.

- Use server-side payment verification.

- Keep API keys and tokens out of frontend code.

- Use proper database access controls.

- Protect administrator access.

- Validate all booking inputs.

- Prevent duplicate webhook processing.

- Prevent duplicate Calendar events.

- Prevent duplicate email confirmations.

- Prevent duplicate WhatsApp reminders.

- Use Asia/Kuala_Lumpur timezone consistently.

- Log failed operations.

- Implement safe retry mechanisms.

- Do not expose private student records.



---



11. TECHNOLOGY AND ARCHITECTURE



Choose the most reliable and affordable architecture that integrates with my existing Netlify website.



Possible components:



- Existing Netlify website: public website and booking interface.

- Lovable: development environment.

- Supabase: database and backend functions, if suitable.

- BCL: existing payment form and payment verification.

- Google Calendar API: class events and attendees.

- Google Meet: unique link for each Tuesday.

- Gmail or suitable transactional email service: confirmation email.

- Meta WhatsApp Business Cloud API: two notification workflows.



Do not assume that writing code means an external service is connected.



Tell me which accounts, credentials, permissions, subscriptions and setup steps are required.



Do not introduce unnecessary paid services.



Explain any ongoing hosting, database, email, Google API or WhatsApp costs before implementation.



---



12. IMPLEMENTATION PLAN — WORK STEP BY STEP



Do not attempt to change everything at once.



Stage 1 — Inspect existing systems



Inspect:



- Existing Netlify website.

- Existing booking page.

- Booking reference generation.

- Selected Tuesday date handling.

- Student information storage.

- Existing BCL payment link.

- Existing database and backend, if any.



Explain how everything currently works.



Do not modify the production website at this stage.



Stage 2 — Integration architecture



Propose the connection between Netlify, BCL, the database and automation services.



Explain how a BCL payment will be matched to its original Netlify booking.



Identify any missing fields or required code changes.



Wait for my approval before making major production changes.



Stage 3 — Booking and database logic



Implement:



- Dynamic four-Tuesday calculation.

- Unique booking references.

- Four-date reservation.

- Maximum 10 students per date.

- Temporary holds.

- Expiry handling.

- Duplicate protection.



Stage 4 — BCL payment verification



Integrate the existing BCL form and supported webhook/API.



Test successful, failed, duplicate, unmatched and delayed payments.



Stage 5 — Google Calendar and Meet



Create one event and one unique Meet link per Tuesday.



Add verified paid students to their four relevant events.



Test attendee invitations and permissions.



Stage 6 — Confirmation email



Send one email containing all four dates and links.



Test delivery and duplicate protection.



Stage 7 — WhatsApp automation



Implement:



- Tuesday 2 PM class reminders.

- Renewal reminders for eligible current students only.



Test inactivity gaps, renewals, duplicate prevention, opt-outs and failed delivery.



Stage 8 — Admin dashboard



Build and secure the dashboard.



Stage 9 — Full system testing



Test:



- A new student booking four Tuesdays.

- A successful RM49 BCL payment.

- An unsuccessful payment.

- A duplicate payment webhook.

- A class reaching 10 paid students.

- An expired reservation.

- Four separate Google Meet links.

- Automatic addition of student email addresses to four events.

- Confirmation email.

- Tuesday 2 PM WhatsApp reminder.

- Student renewing before the renewal reminder.

- Student who has a gap of one month or more.

- Student who remains active and eligible for renewal.

- Duplicate notification prevention.



Only activate live automation after successful end-to-end testing.



---



FINAL PRIORITY



My existing website is already working and I am happy with it.



My existing Netlify booking page and BCL payment form are the foundation of this system.



I want to AUTOMATE the existing process, not replace it.



The most important outcome is:



Student books on Netlify → pays through BCL → payment is verified → four Tuesday dates are confirmed → four different Google Meet links are generated or reused → student receives one email containing all four links → student is added to all four Google Calendar invitations → WhatsApp reminder arrives six hours before each booked class → eligible continuing students receive one renewal reminder after their final class.



Maximum 10 paid students per Tuesday.



All dates must be dynamic and calculated using the current calendar.



Start by inspecting my existing systems and reporting your findings. Do not make production changes before explaining the integration plan and receiving my approval.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/540abfed-b0e6-4e37-8575-a66cb5294004).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Hosting on Netlify

See [DEPLOY-NETLIFY.md](DEPLOY-NETLIFY.md) for the full setup (database, Netlify, Google, BCL, WhatsApp, connecting the public website, and the go-live test checklist).
