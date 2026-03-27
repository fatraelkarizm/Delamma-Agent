# Delamma / Meridian History

Dokumen ini merekam sejarah pengembangan bot, perubahan prompt, dan refinement arsitektur yang sudah terjadi. Tujuannya bukan nostalgia, tapi supaya setiap iterasi berikutnya paham konteks teknis dan tidak mengulang eksperimen yang sama.

## Nama Produk

- Nama kode repo saat ini: `Meridian`
- Arah produk yang diinginkan: `Delamma` sebagai SaaS
- Artinya, semua pengembangan baru idealnya membaca repo ini sebagai fondasi engine, bukan bentuk final produk

## Snapshot Arsitektur Saat Ini

### Runtime utama

- `index.js` masih menjadi orchestration center:
  - cron screening
  - cron management
  - health check
  - REPL CLI
  - Telegram polling
- `core/agent.js` menjalankan loop ReAct LLM -> tool -> result -> final answer
- `lib/prompt.js` membedakan perilaku `SCREENER`, `MANAGER`, dan `GENERAL`

### Tooling dan eksekusi

- `tools/definitions.js` adalah kontrak tool yang dilihat LLM
- `tools/executor.js` adalah dispatcher + safety layer
- Tool domain utama:
  - `tools/dlmm.js`
  - `tools/screening.js`
  - `tools/wallet.js`
  - `tools/token.js`
  - `tools/study.js`

### Memory dan knowledge

- State operasional lokal masih file-based:
  - `data/state.json`
  - `data/lessons.json`
  - `data/pool-memory.json`
  - `data/strategy-library.json`
  - `data/token-blacklist.json`
- Learning sudah cukup maju:
  - lesson injection by role
  - pinned lessons
  - performance-based threshold evolution
  - pool recall dari snapshot mid-position

### Observability dan dashboard

- `lib/db.js` menulis event ke PostgreSQL:
  - `trade_events`
  - `positions`
  - `daily_pnl`
  - `bot_status`
- `dashboard/` adalah Next.js + Prisma dashboard concept
- Prisma schema sudah mulai menyiapkan multi-tenant:
  - `users`
  - `managed_wallets`
  - relasi wallet pada events, positions, dan daily pnl

### Gap menuju SaaS

- Runtime bot masih single-process dan single-wallet oriented
- State source of truth masih campuran file JSON + PostgreSQL
- Dashboard belum full tenant-aware
- Beberapa route dashboard masih fallback ke `state.json`
- Ada drift hasil refactor:
  - sebagian file tools masih mengarah ke path lama seperti `../config.js`, `../state.js`, `../logger.js`
  - ini perlu dirapikan sebelum diposisikan sebagai basis production SaaS

## Timeline Pengembangan

## 2026-03-16 - fondasi intelligence dan due diligence token

Fokus utama di fase ini adalah memperkaya decision engine sebelum deploy:

- tambah `search_pools`
- tambah `get_token_info`
- tambah `get_token_holders`
- tambah smart wallet tracker
- tambah cross-reference smart wallet terhadap holder/PnL
- perbaikan bundler detection dan parsing API
- tambah `self_update` via Telegram
- pasang hard guard awal untuk screening cycle

Makna refinement prompt:

- agent tidak lagi hanya melihat pool score
- agent mulai diberi konteks wallet cerdas, holder distribution, dan token quality sebelum deploy

## 2026-03-17 - koreksi interpretasi metrik dan kontrol operasi

Perubahan penting:

- perbaikan `fee_active_tvl_ratio` agar tidak salah dibaca / dikali 100
- rule management interval setelah deploy dipindah ke base prompt
- interval management disesuaikan dengan volatilitas pool
- perbaikan busy guard cron
- instruction close mulai diperlakukan lebih tegas

Makna refinement prompt:

- prompt makin sadar bahwa angka screening itu timeframe-dependent
- prompt mulai bergerak dari "reason freely" menjadi "reason within explicit operational constraints"

## 2026-03-18 - memory system, narrative filter, compounding, strategy library

Ini salah satu fase paling besar.

Fitur yang masuk:

- pool memory
- token blacklist
- performance history
- briefing watchdog
- token narrative analysis
- definisi narrative baik vs buruk
- role-aware lesson injection
- pinned lessons
- compounding-aware deploy sizing
- hard gate `global_fees_sol`
- strategy library
- dukungan `spot` strategy
- wide range support
- aturan override: user parameter menang atas lesson/default

Makna refinement prompt:

- agent berubah dari bot screening biasa menjadi operator yang punya memori, konteks, dan aturan override yang jelas
- narrative dipromosikan menjadi signal inti, bukan kosmetik
- prompt mulai membedakan apa yang heuristik dan apa yang wajib dipatuhi

## 2026-03-19 - operator control dan configurable management rules

Perubahan besar:

- `user-config.json` bisa override hampir semua config
- hard close rules management diambil dari config, bukan feeling prompt
- position instruction jadi prioritas tertinggi
- gas reserve dipakai lebih konsisten dalam safety check

Makna refinement prompt:

- prompt management makin deterministic
- control pindah dari prompt murni ke kombinasi prompt + config + explicit user intent

## 2026-03-20 - prompt slimming, preloading, role isolation, dan stabilisasi output

Ini fase optimization berat:

- preload data cycle supaya langkah LLM turun drastis
- GENERAL prompt diarahkan untuk fetch parallel
- tool list difilter per role
- output token dinaik-turunkan lalu distabilkan
- valid update_config keys dibuat eksplisit
- screening pre-check diperbaiki
- candidate context diperkaya
- narrative truncation diperpanjang
- auto-swap setelah close diperbaiki
- reporting claim fee masuk management report

Makna refinement prompt:

- arsitektur prompt beralih dari "LLM fetch sendiri" ke "code preload dulu, LLM fokus memutuskan"
- ini sangat penting untuk SaaS karena biaya inferensi, stabilitas, dan auditability jadi lebih masuk akal

## 2026-03-21 - local model support, richer deploy metadata, dan Hive Mind

Perubahan:

- LM Studio support
- deploy notification membawa price range, bin step, base fee
- fee_per_tvl exit rule
- Hive Mind opt-in collective intelligence

Makna refinement prompt:

- agent bukan cuma autonomous trader, tapi mulai diposisikan sebagai networked intelligence system
- observability deploy makin kaya sehingga cocok untuk future dashboarding

## 2026-03-22 - screening/managing makin ketat dan anti-hallucination

Perubahan:

- screening bisa dipicu dari management saat posisi belum penuh
- bundler/top10 threshold configurable
- upper OOR wait rule
- auto-enforce management interval dari posisi paling volatil
- bins_below berbasis volatilitas
- sempat dicoba split screening 2 phase untuk kurangi deploy hallucination
- lalu direvert kembali ke single agent dengan prompt yang lebih ramping

Makna refinement prompt:

- repo ini sudah beberapa kali bereksperimen untuk menurunkan hallucination saat deploy
- kesimpulan sementara: preloaded context + hard code guard + prompt tipis lebih efektif daripada membelah terlalu banyak agent

## 2026-03-23 - eksperimen flip/tokenX-only, lalu refactor balik ke arah stabil

Perubahan:

- ada eksperimen flip bid-ask
- ada tokenX-only deploy flow
- banyak fix bin reuse dan add liquidity flow
- blocked launchpads dipaksa di code sebelum LLM melihat kandidat
- double deploy guard diperkuat
- kemudian ada refactor yang membuang jalur eksperimen itu dan merapikan fondasi

Makna refinement prompt:

- sejarah ini penting: repo sudah mencoba jalan yang lebih kompleks, lalu mundur ke arsitektur yang lebih sederhana
- untuk arah SaaS, itu sinyal bagus: complexity budget harus dijaga

## 2026-03-24 - agent-native CLI dan command enrichment

Perubahan:

- hadir `meridian` CLI
- command candidate diperkaya dengan token info, holders, smart wallets, dan narrative

Makna refinement prompt:

- UX operator mulai diperlakukan serius
- bot tidak lagi hanya autonomous, tapi juga menjadi copilot manusia

## 2026-03-26 - dashboard concept

Perubahan:

- masuk `dashboard/` berbasis Next.js 16 + React 19 + Prisma 7
- schema DB mulai bicara soal `users` dan `managed_wallets`

Makna arsitektur:

- ini adalah titik awal pivot dari single-bot operator tool menuju control panel SaaS
- namun execution engine belum dipisah dari local runtime, jadi transformasinya masih setengah jalan

## Ringkasan Refinement Prompt

Secara garis besar, prompt sudah berevolusi seperti ini:

1. Dari generic autonomous agent menjadi role-based agent (`SCREENER`, `MANAGER`, `GENERAL`)
2. Dari tool-heavy reasoning menjadi preload-heavy reasoning
3. Dari heuristik longgar menjadi hard rule + safety code + config-driven rules
4. Dari sekadar pool screening menjadi token due diligence:
   - smart wallet
   - holder distribution
   - bundler percentage
   - narrative quality
   - trader fee signal
5. Dari memori datar menjadi:
   - pool memory
   - lessons by role
   - pinned lessons
   - performance history
6. Dari static deploy sizing menjadi compounding-aware allocation
7. Dari bot single-session menjadi engine yang mulai siap diaudit dan di-dashboard

## Kesimpulan untuk Arah SaaS

Repo ini sudah punya fondasi intelligence yang kuat. Yang belum selesai bukan "cara berpikir trading-nya", melainkan pemisahan concern untuk SaaS:

- execution engine perlu dipisah dari CLI/Telegram shell
- source of truth perlu dipusatkan ke DB tenant-aware
- worker model perlu dipisah per wallet / tenant
- dashboard perlu berhenti bergantung pada file lokal
- prompt dan tool harus tetap mempertahankan pola yang sudah terbukti:
  - preload context
  - hard guard di code
  - explicit role
  - user override di atas heuristik
