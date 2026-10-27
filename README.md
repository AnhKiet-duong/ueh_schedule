# UEH schedule

Lấy lịch học từ https://student.ueh.edu.vn/Home/Schedules và lưu vào `output/`.

## Cài đặt

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

Điền `UEH_USER` (email UEH) và `UEH_PASS` vào `.env`.

## Chạy

```powershell
npm start
```

Tuỳ chọn (chạy bằng `node fetch-schedule.js ...`):

| Lệnh | Lấy |
| --- | --- |
| `node fetch-schedule.js` | cả học kỳ hiện tại |
| `node fetch-schedule.js --week 18` | chỉ tuần 18 |
| `node fetch-schedule.js --week current` | chỉ tuần hiện tại |
| `node fetch-schedule.js --year 2026 --term HKD` | học kỳ khác (`HKD` đầu, `HKG` giữa, `HKC` cuối) |

### Đăng nhập

- Lần đầu: cửa sổ Edge mở ra, tài khoản/mật khẩu được điền sẵn. Trang có reCAPTCHA
  nên bạn tick captcha và bấm Đăng nhập (có 5 phút).
- Những lần sau: SSO của UEH nhớ đăng nhập (~1 năm, lưu trong `.profile/`), tool chạy
  ngầm và tự bấm "Tiếp tục". Cần đăng nhập lại thì Edge sẽ tự mở ra.

## Kết quả

- `output/schedule.json`: danh sách buổi học (ngày, giờ, tiết, môn, mã LHP, phòng, giảng viên, hình thức học...)
- `output/schedule.csv`: mở bằng Excel
- `output/schedule.ics`: import vào Google Calendar / Outlook (Google Calendar → Cài đặt → Nhập)
