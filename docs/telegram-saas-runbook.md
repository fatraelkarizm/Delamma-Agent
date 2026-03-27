# Telegram SaaS Control-Plane Runbook

Dokumen ini menjelaskan operasi Telegram pada arsitektur SaaS terbaru Meridian/Delamma.

## Tujuan

- Telegram menjadi control-plane tenant/wallet scoped.
- Chat tidak lagi bergantung ke `TELEGRAM_CHAT_ID` global.
- Worker notifications diroute berdasarkan binding `tenant_id` + `wallet_id`.
- Free-form chat hanya untuk local attached wallet, bukan remote SaaS scope.

## Prasyarat

- `TELEGRAM_BOT_TOKEN` valid.
- Runtime punya akses internet ke Telegram API.
- Scope tenant/wallet sudah ditentukan.

## Perintah CLI Inti

### 1) Bind chat ke scope

```bash
node cli.js telegram bind --chat-id <id> --tenant-id <tenant> --wallet-id <wallet>
```

Hasil:
- membuat/refresh binding notifikasi chat ke scope
- meng-upsert active session scope chat tersebut

### 2) Lihat bindings

```bash
node cli.js telegram bindings
node cli.js telegram bindings --chat-id <id>
```

### 3) Unbind

```bash
node cli.js telegram unbind --chat-id <id>
node cli.js telegram unbind --chat-id <id> --tenant-id <tenant> --wallet-id <wallet>
```

### 4) Jalankan gateway Telegram

```bash
node cli.js telegram run
```

Gateway ini memproses command Telegram scope-aware dan meneruskan request remote via control plane.

## Worker/Runtime Mode

Untuk runtime non-interaktif agar adapter Telegram tetap aktif:

```bash
TELEGRAM_RUNTIME_MODE=always
```

Behavior:
- mode TTY: Telegram runtime aktif bila token tersedia
- mode non-TTY: Telegram runtime aktif jika `TELEGRAM_RUNTIME_MODE=always`

## Command Telegram Scope-Aware

Command yang didukung:
- `/scope`, `/bind`, `/bindings`, `/status`
- `/launch`, `/restartworker`, `/start`, `/restart`, `/stop`
- `/manage`, `/screen`, `/briefingrun`
- `/positions`, `/briefing`, `/set`, `/close`

Catatan:
- remote scope (SaaS) diarahkan sebagai control request ke DB control plane
- local attached scope dapat mengeksekusi aksi lokal tertentu (mis. cycle local, `/close` wallet lokal)

## Batasan yang Disengaja

- Free-form chat **hanya** untuk local attached wallet scope.
- Scope remote tidak mengeksekusi wallet action langsung dari chat; command harus lewat control-plane queue.

## Troubleshooting Ringkas

### Polling start tapi tidak ada update

Periksa:
- `TELEGRAM_BOT_TOKEN` valid
- outbound internet ke `api.telegram.org` tidak diblok
- chat sudah ter-bind ke scope

### Chat dianggap unauthorized

Periksa:
- chat terdaftar di `chat-bindings.json` atau session valid
- jika memakai allow-list, `TELEGRAM_ALLOWED_CHAT_IDS` mencakup chat tersebut

### Command remote gagal queue

Kemungkinan:
- DB control plane tidak reachable
- tabel kontrol belum siap

Validasi:
- cek `node cli.js control list --tenant-id <tenant> --wallet-id <wallet>`

## Checklist Verifikasi Setelah Deploy

- bind 1 chat ke 1 scope tenant/wallet
- jalankan `telegram run`
- kirim `/status` untuk scope tersebut
- kirim `/launch` atau `/manage` lalu pastikan request masuk control list
- pastikan notifikasi worker muncul hanya ke chat yang punya binding scope
