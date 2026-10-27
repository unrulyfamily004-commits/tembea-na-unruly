# Tembea na Unruly — website starter

A responsive Kenyan adventure and events website with an Express API, SQLite database, secure admin login, booking intake, manual payment verification, media uploads, and customer inquiries.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set `JWT_SECRET` to a random secret at least 32 characters long. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to a strong, unique administrator account. Never commit `.env`.
4. Install dependencies and start:

   ```sh
   npm install
   npm start
   ```
5. Visit `http://localhost:3000` and `http://localhost:3000/admin.html`.

The administrator is created from environment variables on first startup if that email is not already present. If the database already exists, changing the environment password does not change the stored password; use a deliberate admin-password rotation procedure.

## What is included

- Responsive public homepage with adventure cards, event listings, filters, booking dialog, WhatsApp contact, and inquiry form.
- Public API reads only published listings.
- SQLite tables for admins, listings, bookings, and messages.
- Password hashes (bcrypt), HTTP-only session cookie, JWT expiration, login rate limiting, Helmet security headers, server-side authorization for admin APIs.
- Admin dashboard to create/delete listings, upload image/video media, inspect bookings and inquiries, and update booking/payment statuses.
- M-Pesa Till 8698470 instructions. Bookings start `pending` and payments `unverified`; the site does **not** automatically confirm M-Pesa payments.

## Before production deployment

This is a starter project, not a deployed live service. Before accepting real customer data/payments, use HTTPS; set `NODE_ENV=production`; use a long random `JWT_SECRET`; set strong admin credentials; add CSRF protection/origin checks for cookie-authenticated mutations; add persistent and access-controlled media storage and backups; validate uploaded file contents (not only MIME claims), add upload malware scanning and quotas; add database backups, monitoring, retention/privacy notice, and admin audit logs; configure email/SMS booking notifications; and test thoroughly. SQLite/local uploads require persistent storage and a single-instance deployment unless migrated to managed database/object storage.

## M-Pesa

Manual verification is supported. A real Daraja STK Push or C2B integration is not enabled. To integrate it, configure Safaricom Daraja credentials server-side, validate callback signatures/metadata, reconcile transaction IDs and amounts, and only mark payments verified after trusted server-side confirmation. Never place Daraja secrets in browser code.

## Notes

- Featured cards shown before the API has listings are sample/demo content only. Replace them with real upcoming trips and events from the admin dashboard; no demo dates are invented.
- Images currently use Unsplash image URLs and Google Fonts, so these assets require an internet connection. Replace with licensed brand photography for production.
- Business contact values are displayed as provided: Tembea na Unruly, Leone Lotira, 0700006391, Till 8698470.
