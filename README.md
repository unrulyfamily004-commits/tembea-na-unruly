# TEMBEA NA UNRULY — Vercel + Supabase version

Responsive Kenyan adventure and events booking website with a public homepage, admin dashboard, PostgreSQL database on Supabase, and media uploads to Supabase Storage.

## Required Vercel environment variables
- `DATABASE_URL`: Supabase Transaction Pooler connection string (port 6543).
- `JWT_SECRET`: random secret, at least 32 characters.
- `ADMIN_EMAIL`: administrator email.
- `ADMIN_PASSWORD`: strong administrator password used when the admin account is first created.
- `SUPABASE_URL`: project URL from Supabase Project Settings > API.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role key from Supabase Project Settings > API Keys. Never put it in frontend files or commit it to GitHub.
- `SUPABASE_STORAGE_BUCKET`: `tembea-media`.

## Supabase setup
1. Create a Storage bucket named `tembea-media` and set it to Public so public listing images/videos can be viewed. Do not use the service role key in the browser.
2. Copy the Transaction Pooler connection string from Connect. Ensure its password is correct and reserved characters are URL-encoded.
3. Add all environment variables above in Vercel Project Settings > Environment Variables.

## Local development
Install Node.js 20+, copy `.env.example` to `.env`, fill in all secrets, then run `npm install` and `npm start`. Open `http://localhost:3000` and `/admin.html`.

## Features
- Public adventures and events listing/search.
- Booking intake; bookings begin pending and payment status remains unverified.
- Secure password-hashed admin login and protected admin APIs.
- Admin listing and booking management, customer inquiries, image/video upload.
- M-Pesa Till 8698470 instructions. This does not automatically verify payments and does not implement Safaricom Daraja.

## Deployment notes
Vercel serves files in `public/` as static assets. Express is exported for Vercel and starts a listener for local development. Database schema is initialized from the server on startup. Test the deployment before taking real bookings. Never commit `.env` or expose `SUPABASE_SERVICE_ROLE_KEY`.
