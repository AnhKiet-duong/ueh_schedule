// Lấy lịch học từ https://student.ueh.edu.vn/Home/Schedules
//
// Trang đăng nhập UEH có reCAPTCHA nên tool không tự vượt được: lần đầu tool mở
// cửa sổ Edge, tự điền tài khoản/mật khẩu (từ file .env), bạn chỉ cần tick
// captcha và bấm Đăng nhập. SSO của UEH nhớ đăng nhập khoảng 1 năm (cookie lưu
// trong .profile), nên những lần sau tool chạy ngầm và tự bấm "Tiếp tục".
//
// Cách dùng:
//   node fetch-schedule.js                       cả học kỳ hiện tại
//   node fetch-schedule.js --week 18             chỉ tuần 18
//   node fetch-schedule.js --week current        chỉ tuần hiện tại
//   node fetch-schedule.js --year 2026 --term HKC

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = __dirname;
const PROFILE_DIR = path.join(ROOT, '.profile');
const OUT_DIR = path.join(ROOT, 'output');
const SCHEDULE_URL = 'https://student.ueh.edu.vn/Home/Schedules';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(\w+)$/);
    if (m) args[m[1]] = argv[++i];
  }
  return args;
}

function launch(headless) {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: process.env.UEH_BROWSER || 'msedge',
    headless,
    viewport: { width: 1280, height: 860 },
  });
}

const isLoginPage = (page) => page.url().includes('loginst.ueh.edu.vn');
const toStudentSite = (page) => page.waitForURL((url) => url.hostname === 'student.ueh.edu.vn', { timeout: LOGIN_TIMEOUT_MS });

// SSO còn nhớ tài khoản thì chỉ hiện nút "Tiếp tục/Continue".
async function tryContinue(page) {
  const btn = page.getByRole('button', { name: /Tiếp tục/ });
  if (!(await btn.count())) return false;
  await btn.first().click();
  await toStudentSite(page);
  return true;
}

async function login(page) {
  const user = process.env.UEH_USER;
  const pass = process.env.UEH_PASS;
  if (user && pass) {
    await page.fill('input[name="TaiKhoan"]', user);
    await page.fill('input[name="MatKhau"]', pass);
    const remember = page.locator('input[name="SaveLogin"]');
    if (await remember.count()) await remember.check().catch(() => {});
    console.log('Đã điền tài khoản. Hãy tick captcha rồi bấm Đăng nhập trong cửa sổ Edge...');
  } else {
    console.log('Chưa có UEH_USER/UEH_PASS trong .env — hãy đăng nhập tay trong cửa sổ Edge...');
  }
  await toStudentSite(page);
}

async function openSchedule(context) {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(SCHEDULE_URL, { waitUntil: 'networkidle' });
  if (isLoginPage(page) && await tryContinue(page)) {
    await page.goto(SCHEDULE_URL, { waitUntil: 'networkidle' });
  }
  return page;
}

// Chạy trong trang: đọc HTML một tuần (từ /Home/DrawingSchedules) thành danh sách buổi học.
function parseWeek(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const range = doc.querySelector('.alert')?.textContent.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const dayNames = ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'];

  return [...doc.querySelectorAll('div.Content')].map((div) => {
    const lines = [...div.querySelectorAll('span')].map((s) => s.textContent.replace(/\s+/g, ' ').trim());
    const field = (label) => {
      const line = lines.find((l) => l.startsWith(label + ':'));
      return line ? line.slice(label.length + 1).trim() : '';
    };
    const title = lines[1] || '';
    const course = title.match(/^(.*)\(([^()]+)\)$/);
    // Tooltip ghi "Thứ 2".."Thứ 7" hoặc "Chủ nhật"/"CN".
    const tip = div.getAttribute('data-original-title') || div.getAttribute('title') || '';
    const dayNo = Number(tip.match(/\d+/)?.[0]);
    const offset = dayNo ? dayNo - 2 : 6;
    const date = range ? new Date(Date.UTC(+range[3], range[2] - 1, +range[1] + offset)).toISOString().slice(0, 10) : '';
    const time = field('Giờ học').match(/(\d+)g(\d+)\D+(\d+)g(\d+)/);
    return {
      date,
      day: dayNames[offset] || tip,
      periods: field('Tiết'),
      start: time ? `${time[1].padStart(2, '0')}:${time[2]}` : '',
      end: time ? `${time[3].padStart(2, '0')}:${time[4]}` : '',
      course: course ? course[1].trim() : title,
      courseCode: course ? course[2] : '',
      classCode: field('LHP'),
      room: lines[0] || '',
      lecturer: field('GV'),
      email: field('Email'),
      mode: field('Hình thức học'),
      language: field('Ngôn ngữ'),
    };
  });
}

async function fetchSchedule(page, { year, term, week }) {
  const current = await page.evaluate(() => ({
    year: document.querySelector('#YearStudy').value,
    term: document.querySelector('#TermID').value,
    week: document.querySelector('#Week').value,
  }));
  year = year || current.year;
  term = term || current.term;

  const weeks = await page.evaluate(async (url) => (await fetch(url)).json(), `/Home/GetWeek/${year}$${term}`);
  let selected = weeks;
  if (week === 'current') selected = weeks.filter((w) => String(w.Week) === current.week);
  else if (week) selected = weeks.filter((w) => String(w.DisPlayWeek) === String(week));
  if (!selected.length) throw new Error(`Không có tuần "${week}" trong ${term} ${year}.`);

  const sessions = [];
  for (const w of selected) {
    const url = `/Home/DrawingSchedules?YearStudy=${year}&TermID=${term}&Week=${w.Week}&t=${Math.random()}`;
    const html = await page.evaluate(async (u) => (await fetch(u)).text(), url);
    const items = await page.evaluate(parseWeek, html);
    items.forEach((s) => sessions.push({ week: w.DisPlayWeek, ...s }));
    process.stdout.write(`\rĐang tải tuần ${w.DisPlayWeek}/${weeks.length}...`);
  }
  process.stdout.write('\n');
  // Lịch tuần để trống GV/Email ở buổi LMS và buổi nghỉ: lấy từ buổi khác cùng lớp học phần.
  for (const s of sessions) {
    const other = !s.lecturer && sessions.find((o) => o.classCode === s.classCode && o.lecturer);
    if (other) Object.assign(s, { lecturer: other.lecturer, email: other.email });
    s.cancelled = /^NGH/i.test(s.mode);
  }
  sessions.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { year, term, sessions };
}

function toCsv(sessions) {
  const cols = ['week', 'date', 'day', 'start', 'end', 'periods', 'course', 'courseCode', 'classCode', 'room', 'lecturer', 'email', 'mode', 'language', 'cancelled'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  // BOM để Excel hiển thị đúng tiếng Việt.
  return '﻿' + [cols.join(','), ...sessions.map((s) => cols.map((c) => esc(s[c])).join(','))].join('\r\n');
}

function toIcs(sessions) {
  const esc = (v) => String(v).replace(/[\\;,]/g, (c) => '\\' + c);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const events = sessions.filter((s) => s.date && s.start && !s.cancelled).map((s) => {
    const dt = (t) => s.date.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
    const desc = [`LHP: ${s.classCode}`, `Tiết: ${s.periods}`, `GV: ${s.lecturer}`, `Email: ${s.email}`, `Hình thức: ${s.mode}`];
    return [
      'BEGIN:VEVENT',
      `UID:${s.classCode}-${s.date}-${s.start.replace(':', '')}@ueh-schedule`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Ho_Chi_Minh:${dt(s.start)}`,
      `DTEND;TZID=Asia/Ho_Chi_Minh:${dt(s.end)}`,
      `SUMMARY:${esc(s.course)}`,
      `LOCATION:${esc(s.room || s.mode)}`,
      `DESCRIPTION:${desc.map(esc).join('\\n')}`,
      'END:VEVENT',
    ].join('\r\n');
  });
  const timezone = [
    'BEGIN:VTIMEZONE', 'TZID:Asia/Ho_Chi_Minh',
    'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0700', 'TZOFFSETTO:+0700', 'TZNAME:ICT', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ueh-schedule//VI', 'X-WR-CALNAME:Lịch học UEH', ...timezone, ...events, 'END:VCALENDAR'].join('\r\n');
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  let context = await launch(true);
  let page = await openSchedule(context);

  if (isLoginPage(page)) {
    await context.close();
    context = await launch(false);
    page = await openSchedule(context);
    if (isLoginPage(page)) {
      await login(page);
      await page.goto(SCHEDULE_URL, { waitUntil: 'networkidle' });
    }
  }
  if (isLoginPage(page)) throw new Error('Chưa đăng nhập được vào UEH.');

  const { year, term, sessions } = await fetchSchedule(page, args);
  await context.close();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const write = (name, content) => {
    try {
      fs.writeFileSync(path.join(OUT_DIR, name), content);
    } catch (err) {
      if (err.code !== 'EBUSY') throw err;
      console.warn(`Bỏ qua ${name}: file đang mở trong chương trình khác (Excel?), đóng lại rồi chạy lại.`);
    }
  };
  write('schedule.json', JSON.stringify({ fetchedAt: new Date().toISOString(), year, term, sessions }, null, 2));
  write('schedule.csv', toCsv(sessions));
  write('schedule.ics', toIcs(sessions));
  const cancelled = sessions.filter((s) => s.cancelled).length;
  console.log(`Xong: ${sessions.length - cancelled} buổi học, ${cancelled} buổi nghỉ (${term} ${year}) -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
