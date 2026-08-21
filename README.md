# 🗓️ Freebuff Desktop

**Lên lịch, ghi chú, quản lý sự kiện với AI** — ứng dụng quản lý thời gian all-in-one cho người Việt.

<p align="center">
  <img src="assets/icon.png" width="120" alt="Freebuff Logo">
</p>

<p align="center">
  <a href="#-tính-năng">Tính năng</a> •
  <a href="#-cài-đặt">Cài đặt</a> •
  <a href="#-ứng-dụng-desktop">Desktop</a> •
  <a href="#-web-app">Web App</a> •
  <a href="#-development">Development</a>
</p>

---

## ✨ Tính năng

### 📅 Quản lý sự kiện
- **Lịch thông minh** với FullCalendar — xem ngày/tuần/tháng
- **Sự kiện lặp lại** — hàng ngày, hàng tuần, hàng tháng, hàng năm (RRULE)
- **Kéo thả** để di chuyển/thay đổi thời gian sự kiện
- **Phân tách chuỗi** — "Chỉ lần này" / "Tất cả các lần" / "Tất cả sau lần này"
- **Xung đột lịch** — phát hiện sự kiện trùng giờ
- **Xuất/nhập .ics** — tích hợp Google Calendar, Apple Calendar

### 📝 Ghi chú phong cách Obsidian
- **Markdown source mode** — viết raw markdown, toggle sang rich text
- **Slash commands** — gõ `/` để thêm task list, heading, code block...
- **Task lists** — checkbox tương tác, đếm tiến độ `2/5`
- **Font & màu sắc** — đổi font, màu chữ, highlight
- **Copy as Markdown** — xuất ghi chú dạng .md

### 🎯 Kế hoạch (Planner)
- **6 vùng thời gian**: Quá hạn → Hôm nay → Tuần này → Tháng này → Năm nay → Tương lai
- **Tự động phân loại** sự kiện theo ngày
- **TodoChip** — hiển thị tiến độ task ngay trên planner

### 🔔 Nhắc nhở
- **Thông báo trình duyệt** khi sự kiện sắp bắt đầu
- **Đồng hồ nhắc** trong Today view
- **Cài đặt thời gian nhắc** — 5/10/15/30 phút trước

### 🎨 Giao diện
- **Dark/Light/Custom theme** — chuyển đổi mượt mà
- **Accent color picker** — 6 màu preset + chọn tự do
- **Responsive** — hoạt động trên desktop và tablet
- **Animation** — GSAP transitions, toast notifications

### 🔄 Đồng bộ & Chia sẻ
- **Supabase** — dữ liệu đám mây, sync đa thiết bị
- **Workspace chia sẻ** — mã code 7 ký tự, cùng làm việc nhóm
- **Undo/Redo** — Ctrl+Z/Y跨越 toàn bộ chỉnh sửa
- **Thùng rác** — xóa mềm, khôi phục, lịch sử 30 ngày

---

## 📥 Cài đặt

### 🖥️ Ứng dụng Desktop (Windows)

**Cách 1: Tải file cài đặt**
1. Download `Freebuff Desktop Setup 1.0.0.exe` từ [Releases](https://github.com/William-Rowan-Waltor/freebuff-desktop/releases)
2. Chạy file `.exe` → cài đặt tự động
3. Mở ứng dụng từ Start Menu hoặc Desktop shortcut

**Cách 2: Build từ source**
```bash
git clone https://github.com/William-Rowan-Waltor/freebuff-desktop.git
cd freebuff-desktop
npm install
npm run electron:build
# File cài đặt sẽ nằm trong thư mục release/
```

**Yêu cầu:**
- Windows 10/11 (64-bit)
- File `.env.local` chứa Supabase keys (xem bên dưới)

### 🌐 Web App (Online)

**Cách 1: Deploy trên Vercel (khuyến nghị)**
```bash
# Fork repo trên GitHub
# Kết nối với Vercel tại vercel.com
# Thêm environment variables:
#   NEXT_PUBLIC_SUPABASE_URL = https://xxx.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJhbG...
# Deploy tự động
```

**Cách 2: Chạy locally**
```bash
git clone https://github.com/William-Rowan-Waltor/freebuff-desktop.git
cd freebuff-desktop
npm install
cp .env.example .env.local  # Thêm Supabase keys
npm run dev
# Mở http://localhost:3000
```

---

## ⚙️ Cấu hình

### Environment Variables

Tạo file `.env.local` trong thư mục gốc:

```env
# Supabase (bắt buộc)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Supabase Service Role (cho admin operations, optional)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Database Setup

Chạy các migration trong Supabase SQL Editor:

```sql
-- 1. Schema chính (blocks, block_relations, files)
\i supabase/schema.sql

-- 2. Soft delete support
\i supabase/migrate_live_softdelete.sql

-- 3. Recurrence columns
ALTER TABLE public.blocks ADD COLUMN IF NOT EXISTS recurrence text;
ALTER TABLE public.blocks ADD COLUMN IF NOT EXISTS recurrence_exceptions text[];

-- 4. Reload PostgREST schema
NOTIFY pgrst, 'reload schema';
```

---

## 🛠️ Development

### Tech Stack
- **Frontend**: Next.js 16 + React 19 + TypeScript
- **Styling**: Tailwind CSS 4 + GSAP
- **Editor**: Tiptap v3 (Markdown + rich text)
- **Calendar**: FullCalendar v7 + rrule
- **Database**: Supabase (PostgreSQL)
- **State**: Zustand
- **Desktop**: Electron 43

### Commands

```bash
# Development
npm run dev              # Next.js dev server
npm run electron:dev     # Electron + dev server

# Production
npm run build            # Next.js build
npm run start            # Next.js production server
npm run electron:build   # Build desktop installer

# Testing
npm run test             # Run all tests
npm run lint             # ESLint

# Utilities
npm run icons            # Regenerate app icons
```

### Project Structure

```
freebuff-desktop/
├── app/                    # Next.js app router
│   ├── login/              # Login page
│   ├── page.tsx            # Main workspace
│   └── globals.css         # Global styles
├── components/
│   ├── calendar/           # CalendarView, RecurrenceChoice
│   ├── editor/             # EditorPane, SlashMenu, Toolbar
│   ├── layout/             # MainWorkspace, Sidebar, Settings
│   ├── planner/            # PlannerView
│   └── today/              # TodayView (digest)
├── electron/
│   └── main.cjs            # Electron main process
├── lib/                    # Utilities (recurrence, ics, etc.)
├── store/                  # Zustand stores
├── supabase/               # Database migrations
├── assets/                 # App icons
└── release/                # Build output (gitignored)
```

---

## 📦 Tính năng Desktop

Ứng dụng desktop (`electron/main.cjs`) hoạt động như một app native:

- **Offline-ready**: Chạy local server, không cần browser tab
- **Auto-update ready**: Tích hợp electron-updater
- **Single instance**: Chỉ mở 1 cửa sổ, click lần 2 focusing cửa sổ hiện tại
- **External links**: Link http mở trong browser hệ thống
- **Free port**: Tự chọn port trống, không conflict

### Offline vs Online

| Chế độ | Mô tả |
|--------|--------|
| **Offline** | App chạy local, dữ liệu lưu trong Supabase (cần internet lần đầu) |
| **Online** | Web app trên Vercel, truy cập từ mọi nơi |

---

## 🤝 Đóng góp

1. Fork repo
2. Tạo branch (`git checkout -b feature/amazing-feature`)
3. Commit (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing-feature`)
5. Mở Pull Request

---

## 📄 License

MIT License - Xem [LICENSE](LICENSE) để biết chi tiết.

---

## 🔗 Liên kết

- **GitHub**: [William-Rowan-Waltor/freebuff-desktop](https://github.com/William-Rowan-Waltor/freebuff-desktop)
- **Issues**: [GitHub Issues](https://github.com/William-Rowan-Waltor/freebuff-desktop/issues)
- **Releases**: [GitHub Releases](https://github.com/William-Rowan-Waltor/freebuff-desktop/releases)

---

<p align="center">
  Made with ❤️ by Freebuff Team
</p>
