# Affiliate Outreach Queue

Dashboard Next.js untuk autopost dan outreach queue affiliate Shopee dengan target Threads.

## Jalankan lokal

```bash
cd /Users/adipsafiudin/Documents/autopost
npm install
cp .env.example .env.local
npm run dev
```

Buka:

```text
http://localhost:3000
```

## Environment

Isi `.env.local` untuk Threads live mode:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
THREADS_CLIENT_ID=your_threads_app_id
THREADS_CLIENT_SECRET=your_threads_app_secret
THREADS_REDIRECT_URI=http://localhost:3000/auth/threads/callback
THREADS_DISCOVERY_PROVIDER_URL=
```

Untuk Vercel, set variable yang sama di Project Settings. Setelah deploy, ubah:

```bash
NEXT_PUBLIC_APP_URL=https://domain-vercel-kamu.vercel.app
THREADS_REDIRECT_URI=https://domain-vercel-kamu.vercel.app/auth/threads/callback
```

Di Meta Developers, isi callback Threads API:

```text
URL Callback Alihkan:
https://domain-vercel-kamu.vercel.app/auth/threads/callback

Hapus Instalasi URL Callback:
https://domain-vercel-kamu.vercel.app/auth/threads/deauthorize

Hapus URL Callback:
https://domain-vercel-kamu.vercel.app/auth/threads/delete-data
```

## Fitur

- Input manual link affiliate Shopee dan profil produk.
- Generate 5 draft konten per produk dengan disclosure affiliate.
- Opportunity Finder via API route Next.js.
- Reply approval queue dan scheduler.
- Threads OAuth, publish post, dan reply adapter via API routes.
- Mode `mock`, `api-ready`, dan `live`.
- Data operasional disimpan di browser `localStorage`.

## Catatan Vercel

Access token Threads disimpan di HttpOnly cookie agar tidak bergantung filesystem server. Untuk produksi yang lebih serius, pindahkan token dan state ke database seperti Vercel KV, Supabase, Neon, atau Postgres.

Threads public search tidak di-hard-code dengan scraping. Jika kamu punya sumber resmi/berizin untuk discovery, isi `THREADS_DISCOVERY_PROVIDER_URL`. Endpoint tersebut menerima `{ products, settings }` dan mengembalikan `{ opportunities: [...] }`.
