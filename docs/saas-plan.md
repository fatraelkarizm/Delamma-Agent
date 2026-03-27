# Delamma SaaS Plan

Dokumen ini adalah rencana eksekusi untuk mengubah codebase `Meridian` menjadi `Delamma`, yaitu SaaS untuk autonomous DLMM management di Solana.

Plan ini sengaja dibuat berdasarkan kondisi repo saat ini, bukan arsitektur imajiner. Jadi isinya menyeimbangkan 3 hal:

- apa yang sudah bagus dan perlu dipertahankan
- apa yang belum rapi dan harus distabilkan
- apa yang perlu dibangun supaya benar-benar layak jadi SaaS

## Goal

Bangun Delamma sebagai platform yang:

- multi-tenant
- multi-wallet
- aman untuk live trading
- auditable
- observable
- prompt-efficient
- bisa dioperasikan via dashboard, bukan hanya CLI/Telegram

## Current State

Saat ini repo sudah punya:

- engine agent yang cukup matang
- prompt role-based yang sudah bagus
- tooling DLMM / wallet / token / narrative / smart wallet
- local memory system
- PostgreSQL event sink
- dashboard concept dengan Prisma schema yang mulai multi-tenant

Tapi repo belum benar-benar SaaS-ready karena:

- runtime masih menumpuk di `index.js`
- execution masih single-wallet oriented
- source of truth masih campuran file JSON dan DB
- dashboard masih fallback ke file lokal
- belum ada boundary tegas antara control plane dan execution plane

## North Star Architecture

Target bentuk sistem:

### 1. Web App / Control Plane

Tanggung jawab:

- auth user
- tenant management
- wallet management
- config management
- strategy management
- bot lifecycle control
- observability
- billing nanti

Teknologi yang sudah cocok untuk jadi fondasi:

- `dashboard/` Next.js
- Prisma
- PostgreSQL

### 2. API Layer

Tanggung jawab:

- tenant-scoped CRUD
- wallet-scoped config
- job dispatch
- read models untuk dashboard
- audit/event access

### 3. Worker / Execution Plane

Tanggung jawab:

- screening cycle
- management cycle
- health checks
- morning briefing
- tool execution
- on-chain transaction handling

Catatan penting:

- worker harus berjalan per managed wallet
- worker tidak boleh bergantung pada TTY, REPL, atau local interactive shell

### 4. Intelligence Layer

Tanggung jawab:

- prompt composition
- role routing
- lesson injection
- pool recall
- strategy application
- safe tool exposure

Layer ini dipertahankan, tapi dibuat tenant-aware dan wallet-aware.

### 5. Persistence Layer

Target source of truth utama:

- PostgreSQL

Yang akan dimigrasikan dari file lokal:

- state
- lessons
- pool memory
- strategy library
- blacklist
- config override

## Guiding Principles

### Preserve what already works

Jangan buang hal yang sudah terbukti bagus:

- preload context sebelum LLM
- hard safety checks di code
- role-based tool restriction
- user override di atas heuristic
- prompt tipis dan operasional

### Separate planes early

Pisahkan:

- UI
- API
- background worker
- intelligence engine
- persistence

Semakin lama ini ditunda, semakin mahal refactornya.

### DB-first for SaaS features

Fitur baru yang sifatnya SaaS harus langsung lahir tenant-aware dan DB-backed.

JSON file dipertahankan hanya untuk:

- local dev
- backward compatibility sementara
- emergency fallback

### Every critical action must be auditable

Minimal untuk action penting:

- siapa tenant-nya
- wallet mana
- kapan terjadi
- role agent mana
- prompt context versi apa
- tool apa yang dipanggil
- hasilnya apa

## Phase Plan

## Phase 0 - Stabilize the Foundation

Tujuan:

- membereskan drift arsitektur supaya migrasi SaaS tidak dibangun di atas kondisi ambigu

Pekerjaan:

- rapikan import/path drift akibat refactor
- pastikan semua modul runtime mengacu ke lokasi file yang benar
- pastikan naming `lib/*`, `memory/*`, `core/*`, `tools/*` konsisten
- inventaris mana yang masih baca root `state.json` / `lessons.json` lama
- tentukan satu compatibility layer untuk local file storage

Deliverable:

- runtime lokal stabil
- tidak ada modul yang diam-diam mengacu ke path lama
- daftar state lokal yang akan dimigrasikan ke DB

Definition of done:

- app jalan tanpa ambiguity source path
- dashboard read path tercatat jelas
- semua file-state dependency terpetakan

## Phase 1 - Extract the Core Engine

Tujuan:

- memisahkan bot engine dari shell interaktif

Pekerjaan:

- pecah `index.js` menjadi beberapa service boundary:
  - app bootstrap
  - scheduler
  - agent service
  - telegram adapter
  - cli adapter
- buat interface eksplisit untuk:
  - run screening cycle
  - run management cycle
  - run health check
  - run briefing
- hilangkan asumsi bahwa runtime harus punya stdin/TTY

Deliverable:

- engine bisa dipanggil dari worker tanpa CLI
- CLI dan Telegram menjadi adapter, bukan pusat sistem

Definition of done:

- cycle bisa dijalankan sebagai service method
- REPL tetap jalan, tapi bukan dependency utama execution

## Phase 2 - Move Operational State to PostgreSQL

Tujuan:

- menjadikan DB sebagai source of truth utama untuk mode SaaS

Pekerjaan:

- tambahkan tabel / model untuk:
  - wallet configs
  - lessons
  - pool memory
  - strategy library
  - token blacklist
  - agent runs
  - tool calls
  - prompt snapshots / prompt versions
- buat repository layer untuk baca/tulis state
- buat mode dual-write sementara:
  - DB write
  - optional JSON compatibility write
- migrasi dashboard agar baca DB dulu, bukan file lokal

Deliverable:

- semua state penting tersedia di DB
- dashboard tidak perlu filesystem untuk membaca kondisi utama

Definition of done:

- worker bisa start dari DB-backed state
- local JSON tidak lagi jadi source of truth utama untuk SaaS mode

## Phase 3 - Introduce Wallet-Scoped Workers

Tujuan:

- satu tenant bisa punya satu atau lebih managed wallet dengan siklus independen

Pekerjaan:

- definisikan lifecycle worker per wallet:
  - start
  - pause
  - resume
  - stop
- tambahkan job orchestration:
  - screening schedule
  - management schedule
  - health schedule
  - briefing schedule
- setiap worker harus menerima:
  - tenant id
  - wallet id
  - resolved config
  - execution mode

Deliverable:

- worker model yang tidak lagi single-wallet global

Definition of done:

- 2 wallet aktif bisa berjalan tanpa berbagi state sembarangan
- semua log dan event punya `wallet_id`

## Phase 4 - Tenant-Aware Dashboard and API

Tujuan:

- dashboard benar-benar menjadi control plane SaaS

Pekerjaan:

- implement auth
- map `User -> ManagedWallet`
- buat halaman:
  - wallets
  - bot status
  - open positions
  - performance
  - config
  - strategy library
  - lessons
  - event log
- buat action dashboard:
  - start bot
  - pause bot
  - run screening now
  - run management now
  - update config
  - set active strategy

Deliverable:

- operator bisa mengontrol wallet dari web app tanpa harus masuk CLI

Definition of done:

- dashboard bisa melakukan operasi inti terhadap wallet tertentu
- data yang ditampilkan tenant-scoped

## Phase 5 - Production Hardening

Tujuan:

- membuat Delamma siap dipakai di lingkungan production

Pekerjaan:

- retry policy dan idempotency key untuk write actions
- secret management untuk encrypted private keys
- stronger audit/event pipeline
- alerting
- rate limiting
- runbook incident
- backup / restore flow
- environment separation:
  - local
  - staging
  - production

Deliverable:

- sistem yang bisa dijalankan lebih aman untuk live tenant

Definition of done:

- worker recovery jelas
- duplicate execution risk terkendali
- credential handling layak production

## Recommended Build Order

Urutan yang paling realistis:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5

Alasannya:

- kalau DB migration dilakukan sebelum engine dipisah, coupling akan makin kusut
- kalau dashboard dikerjakan dulu sebelum worker model jelas, UI akan menumpuk technical debt

## Immediate MVP Scope

Versi SaaS MVP yang paling masuk akal:

- 1 user login
- multiple managed wallets
- per-wallet config
- start/pause worker dari dashboard
- lihat positions, trade history, dan bot status
- screening + management worker per wallet
- DB-backed event log

Belum perlu di MVP:

- billing
- teams / org roles
- hive mind publik
- collaborative features
- advanced multi-region infra

## Data Model Direction

Model yang sudah ada dan harus dipakai:

- `User`
- `ManagedWallet`
- `TradeEvent`
- `Position`
- `DailyPnl`
- `BotStatus`

Model yang perlu ditambahkan:

- `WalletConfig`
- `Lesson`
- `PoolMemory`
- `PoolNote`
- `Strategy`
- `TokenBlacklist`
- `AgentRun`
- `ToolCall`
- `WorkerLease`
- `PromptVersion`

## Runtime Design Direction

Target runtime:

- `web` service
- `worker` service
- `db`

Minimal service boundary:

- web membaca dan mengirim command
- worker mengeksekusi cycle
- DB menyimpan state dan event

Jangan lagi menaruh seluruh orchestration production di satu `index.js`.

## Migration Strategy

Supaya aman, migrasi dilakukan bertahap:

### Step 1

- read from JSON
- write to JSON + DB

### Step 2

- read from DB
- fallback to JSON
- write to DB

### Step 3

- DB-only untuk SaaS mode
- JSON hanya local compatibility mode

Ini penting supaya migrasi tidak mematikan runtime yang sekarang.

## Risks

### 1. State split-brain

Kalau JSON dan DB sama-sama dianggap source of truth, bug akan sulit dilacak.

Mitigasi:

- definisikan source of truth per phase
- gunakan dual-write hanya sementara

### 2. Worker duplication

Kalau dua worker memproses wallet yang sama, deploy/close bisa double.

Mitigasi:

- lease / lock per wallet
- idempotency key per action

### 3. Prompt bloat after SaaS migration

Saat data makin banyak, prompt bisa membesar.

Mitigasi:

- tetap preload ringkas
- gunakan structured summaries
- simpan full detail di DB, kirim ke prompt hanya yang relevan

### 4. Security debt

Private key handling saat ini belum diposisikan sebagai multi-tenant production concern.

Mitigasi:

- encrypt secrets at rest
- batasi akses worker
- audit access path

## First Implementation Sprint

Kalau langsung mulai coding, sprint pertama yang paling sehat adalah:

1. rapikan Phase 0 drift
2. extract cycle runner dari `index.js`
3. definisikan service interface untuk screening / management
4. buat repository abstraction untuk state
5. pindahkan dashboard read path ke DB-first

Output sprint ini belum "SaaS selesai", tapi akan membuat seluruh langkah setelahnya jauh lebih aman.

## Concrete Next Tasks

Backlog prioritas tertinggi:

- audit dan perbaiki import/path drift
- pecah `index.js`
- buat `services/` untuk cycle runner
- buat `repositories/` untuk state access
- buat mode DB-first untuk dashboard API
- tambahkan model persistence untuk lessons dan wallet config
- tambahkan `wallet_id` ke runtime event yang belum konsisten

## Decision Log

Keputusan yang sebaiknya dianggap aktif mulai sekarang:

- Delamma dibangun DB-first untuk fitur SaaS
- file JSON dianggap compatibility layer
- CLI dan Telegram bukan pusat arsitektur production
- worker harus wallet-scoped
- prompt tetap tipis, preloaded, dan role-based
- hard safety tetap di code, bukan di prompt

## Success Criteria

Kita bisa bilang transformasi ke SaaS berhasil kalau:

- user bisa login ke dashboard
- user bisa menambah wallet
- tiap wallet punya config sendiri
- worker tiap wallet bisa jalan independen
- semua posisi, event, dan performance bisa dilihat dari dashboard
- runtime production tidak bergantung pada file lokal
- audit log cukup jelas untuk menelusuri keputusan agent

## Recommended Next Move

Langkah paling tepat setelah dokumen ini:

- eksekusi Phase 0 dan Phase 1 dulu

Artinya, refactor pertama yang paling bernilai bukan bikin UI baru, tapi:

- membereskan fondasi runtime
- memisahkan engine dari shell
- menyiapkan boundary worker yang benar

Kalau fondasi ini rapi, barulah Delamma bisa tumbuh jadi SaaS tanpa membawa terlalu banyak hutang teknis dari mode lokal.
