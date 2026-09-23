/* Nhắc ôn chủ động — chạy bởi GitHub Actions (miễn phí).
   Quyết định dựa trên: lịch FSRS (sr.due), thời điểm THÊM từ (createdAt),
   và lần ÔN gần nhất (sr.last). Mỗi ngày tối đa 1 thông báo. */
const admin = require("firebase-admin");

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const TZ = "Asia/Ho_Chi_Minh";
const APP_URL = "https://david9827.github.io/WordList/";
const FORCE = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || process.env.FORCE === "1";

const dstr = (d) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const todayStr = () => dstr(new Date());
const hourNow = () =>
  parseInt(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }), 10);
const dayDiff = (a, b) =>
  Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

// Giờ nhắc = khung giờ user hay học nhất (app tự học); mặc định 20h
function peakHour(a) {
  let best = -1, bestC = -1;
  for (const k in (a || {})) { if (a[k] > bestC) { bestC = a[k]; best = parseInt(k, 10); } }
  return best >= 0 ? best : 20;
}

/* Chọn lý do nhắc, ưu tiên từ trên xuống. Trả null nếu không cần nhắc. */
function decide(words, today, d) {
  const ws = (words || []).filter(Boolean);
  if (!ws.length) return null;

  const due = ws.filter((w) => w.sr && w.sr.due && w.sr.due <= today).length;
  if (due > 0) {
    return { key: "due", title: "Đến giờ ôn từ 📚",
             body: `Bạn có ${due} từ đến hạn ôn hôm nay — ôn ngay để nhớ lâu!` };
  }

  // Từ thêm hôm nay mà chưa ôn lần nào (ôn lần đầu trong ngày giúp nhớ tốt hơn nhiều)
  const addedTodayNew = ws.filter(
    (w) => w.createdAt && dstr(new Date(w.createdAt)) === today && !(w.sr && w.sr.last)
  ).length;
  if (addedTodayNew > 0) {
    return { key: "new-today", title: "Từ mới chờ bạn ✨",
             body: `Bạn vừa thêm ${addedTodayNew} từ mới. Ôn lần đầu ngay hôm nay để ghi nhớ sâu hơn.` };
  }

  // Từ đã thêm từ hôm trước nhưng chưa ôn lần nào
  const neverReviewed = ws.filter((w) => w.sr && !w.sr.last).length;
  if (neverReviewed > 0) {
    return { key: "never", title: "Có từ chưa ôn lần nào 📖",
             body: `${neverReviewed} từ trong kho vẫn chưa được ôn. Bắt đầu nhé!` };
  }

  // Lâu rồi chưa ôn (giữ nhịp học) — ưu tiên mốc luyện tập chính xác tới giờ
  let gap = null;
  if (d && d.lastPracticeAt) {
    gap = Math.floor((Date.now() - d.lastPracticeAt) / 86400000);
  } else {
    const lasts = ws.map((w) => w.sr && w.sr.last).filter(Boolean).sort();
    if (lasts.length) gap = dayDiff(lasts[lasts.length - 1], today);
  }
  if (gap !== null && gap >= 3) {
    return { key: "idle", title: "Lâu rồi chưa ôn từ 👋",
             body: `Đã ${gap} ngày bạn chưa luyện. Ôn lại vài phút để không quên nhé!` };
  }
  return null;
}

(async () => {
  const today = todayStr();
  const nowH = hourNow();
  const snap = await db.collection("users").get();
  let sent = 0;
  console.log(`Mode=${FORCE ? "TEST (ep gui)" : "theo lich"} | ${today} ${nowH}h | users=${snap.size}`);

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const tokens = Object.keys(d.fcmTokens || {});
    const ph = peakHour(d.activityHours);
    const fmt=t=>t?new Date(t).toLocaleString("vi-VN",{timeZone:TZ}):"-";
    console.log(`  user=${doc.id} tokens=${tokens.length} gioBao=${ph}h | themTuCuoi=${fmt(d.lastAddAt)} | luyenCuoi=${fmt(d.lastPracticeAt)} | daBao=${d.lastNotified||"-"}`);
    if (!tokens.length) continue;

    // mỗi ngày tối đa 1 thông báo
    if (!FORCE && d.lastNotified === today) { console.log("    -> hom nay da gui roi"); continue; }

    /* GitHub chỉ chạy lịch ~4-5 lan/ngay vao gio ngau nhien, nen khong the doi
       dung 1 gio. Mo rong thanh CUA SO [gioHayHoc-3 .. cuoi ngay], va neu da lo
       mat hon 1 ngay thi bat ky lan chay nao tu 9h tro di cung gui (bat kip). */
    const startH = Math.max(0, ph - 3);
    const gapDays = d.lastNotified ? dayDiff(d.lastNotified, today) : 99;
    const inWindow = nowH >= startH;
    const catchUp = gapDays >= 2 && nowH >= 9;
    if (!FORCE && !inWindow && !catchUp) {
      console.log(`    -> chua toi cua so gui (can >=${startH}h, dang ${nowH}h)`); continue;
    }
    if (catchUp && !inWindow) console.log(`    -> bat kip: da ${gapDays} ngay chua bao`);

    // Từ vựng nằm ở subcollection users/{uid}/words
    let words = [];
    try{
      const ws = await doc.ref.collection("words").get();
      ws.forEach((x) => words.push(x.data()));
    }catch(e){ console.log("    loi doc subcollection:", e.message); }
    if (!words.length && Array.isArray(d.words)) words = d.words;   // dữ liệu cũ
    const reason = decide(words, today, d);
    console.log(`    tong tu=${words.length} lyDo=${reason ? reason.key : "khong can nhac"}`);
    if (!reason && !FORCE) continue;

    const msg = reason || { title: "Ôn từ vựng 📚", body: "Thông báo thử — hệ thống nhắc ôn hoạt động tốt." };
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: msg.title, body: msg.body },
      webpush: { fcmOptions: { link: APP_URL } },
    });

    const update = { lastNotified: today };
    res.responses.forEach((r, i) => {
      const code = r.success ? null : (r.error && r.error.code);
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token") {
        update["fcmTokens." + tokens[i]] = admin.firestore.FieldValue.delete();
      }
    });
    await doc.ref.update(update);
    sent++;
    console.log(`    -> da gui "${msg.title}" | thanh cong=${res.successCount} that bai=${res.failureCount}`);
    res.responses.forEach((r, i) => { if (!r.success) console.log(`       loi[${i}]: ${r.error && r.error.code}`); });
  }
  console.log(`Done. sent=${sent}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
