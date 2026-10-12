# Rey Market

Panel web lokal untuk mengelola akun, permintaan top-up simulasi, order register ECID, dan pencatatan pemeriksaan status FMI/iCloud yang berwenang. Proyek ini **tidak** melakukan bypass Activation Lock, penghapusan iCloud, maupun akses perangkat tanpa izin. Belum ada integrasi pembayaran atau pemeriksaan perangkat otomatis.

## Yang dibutuhkan

- Node.js versi 22.13 atau lebih baru (proyek memakai SQLite bawaan Node.js)
- npm (ikut terpasang dengan Node.js)
- Koneksi internet saat pertama kali memasang paket

## Jalankan di Windows

1. Pasang Node.js dari [nodejs.org](https://nodejs.org/) jika belum ada.
2. Buka PowerShell pada folder `Rey-Market`.
3. Jalankan `npm install` sekali untuk memasang paket.
4. Jalankan `npm start`.
5. Buka `http://localhost:3000` di browser.
6. Pilih **Daftar sekarang**, buat akun, lalu masuk.

### Jika PowerShell menolak `npm`

Jika muncul pesan `npm.ps1 cannot be loaded because running scripts is disabled`, gunakan executable Windows `npm.cmd` dari folder proyek yang sama:

```powershell
npm.cmd install
npm.cmd start
```

Cara ini tidak memerlukan perubahan Execution Policy PowerShell. Setelah server berjalan, biarkan jendela terminal tetap terbuka selama menggunakan panel.

Server menyimpan database SQLite pada folder `data/`, yang dibuat otomatis. Akun dan riwayat tersimpan di database. Sesi login demo disimpan sementara oleh server dan berakhir saat server dimulai ulang. Simpan salinan folder `data/` jika perlu mencadangkan data.

## Menyiapkan admin

Untuk demo lokal, buat akun melalui halaman daftar terlebih dahulu. Hentikan server (tekan `Ctrl+C`), lalu jalankan server dengan email akun sebagai admin:

```powershell
$env:ADMIN_EMAIL="ptriisw@gmail.com"
$env:SESSION_SECRET="151525"
npm start
```

Server memberi role admin kepada akun dengan email tersebut. Keluar lalu masuk kembali untuk melihat menu **Admin**. Di sana admin dapat melihat akun, mengonfirmasi top-up, serta memperbarui status dan catatan hasil order. API admin memeriksa role sebelum mengizinkan perubahan.

Top-up selalu berstatus **pending** sampai dikonfirmasi admin. Ini demo manual; tidak ada uang yang diproses oleh aplikasi.

## Struktur folder

```text
Rey-Market/
├── public/
│   ├── app.js       Logika tampilan, formulir, dan komunikasi ke server
│   ├── index.html   Kerangka halaman login dan dashboard
│   └── style.css    Tema gelap, responsif untuk desktop dan ponsel
├── data/            Database SQLite (dibuat saat server berjalan)
├── package.json     Daftar paket dan perintah npm
└── server.js        API, validasi, autentikasi, dan skema database
```

## Layanan dan validasi

- ECID menerima 8 atau 16 karakter heksadesimal.
- Kelompok perangkat yang tersedia: A12/A13 dan A7/A11.
- Order dan hasilnya dicatat. Status awal `pending` dan dapat diperbarui admin menjadi `processing`, `completed`, atau `rejected`.
- FMI/iCloud adalah permintaan pencatatan/pemeriksaan status untuk perangkat yang berwenang saja. Tidak ada fungsi unlock, bypass, atau penghapusan akun.
- Password disimpan dalam bentuk hash. SQLite memakai modul bawaan Node.js sehingga tidak perlu Visual Studio Build Tools. Sesi login disimpan sementara selama proses server aktif. Gunakan penyimpanan sesi persisten, `SESSION_SECRET` unik, dan HTTPS sebelum deployment publik.

## API singkat

| Method | Path | Keterangan |
|---|---|---|
| POST | `/api/signup` | Buat akun |
| POST | `/api/login` | Masuk |
| POST | `/api/logout` | Keluar |
| GET | `/api/data` | Profil, order, top-up, transaksi akun |
| POST | `/api/topups` | Catat permintaan top-up |
| POST | `/api/orders` | Catat order layanan |
| GET | `/api/admin/overview` | Data admin |
