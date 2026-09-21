/* Gửi thông báo nhắc ôn (FCM) — chạy bởi GitHub Actions, MIỄN PHÍ (không cần Blaze).
   Đọc Firestore, với mỗi user: nếu đúng khung giờ họ hay học và có từ due<=hôm nay thì gửi. */
const admin = require("firebase-admin");

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const TZ = "Asia/Ho_Chi_Minh";
const APP_URL = "https://david9827.github.io/WordList/";
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const FORCE = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || process.env.FORCE === "1";
const hourNow = () =>
  parseInt(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }), 10);

function peakHour(a) {
  let best = -1, bestC = -1;
  for (const k in (a || {})) { if (a[k] > bestC) { bestC = a[k]; best = parseInt(k, 10); } }
  return best >= 0 ? best : 20; // mặc định 20h nếu chưa có dữ liệu thói quen
}

(async () => {
  const today = todayStr();
  const nowH = hourNow();
  const stamp = `${today}T${nowH}`;
  const snap = await db.collection("users").get();
  let sent = 0;
  console.log(`Mode: ${FORCE ? "TEST (ep gui)" : "theo lich"} | today=${today} hour=${nowH} | users=${snap.size}`);

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const tokens = Object.keys(d.fcmTokens || {});
    console.log(`  user=${doc.id} tokens=${tokens.length} gioBao=${peakHour(d.activityHours)}h`);
    if (!tokens.length) continue;
    if (!FORCE && peakHour(d.activityHours) !== nowH) continue;  // chưa tới giờ user hay học
    if (!FORCE && d.lastNotified === stamp) continue;            // đã gửi trong giờ này rồi

    const words = d.words || [];
    const due = words.filter((w) => w && w.sr && w.sr.due && w.sr.due <= today).length;
    console.log(`    tong tu=${words.length} den han=${due}`);
    if (!FORCE && due <= 0) continue;                     // không có từ đến hạn → im lặng

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: "Ôn từ vựng 📚", body: due > 0
        ? `Bạn có ${due} từ đến hạn ôn hôm nay!`
        : "Thông báo thử — hệ thống nhắc ôn hoạt động tốt." },
      webpush: { fcmOptions: { link: APP_URL } },
    });

    const update = { lastNotified: stamp };
    res.responses.forEach((r, i) => {
      const code = r.success ? null : (r.error && r.error.code);
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token") {
        update["fcmTokens." + tokens[i]] = admin.firestore.FieldValue.delete();
      }
    });
    await doc.ref.update(update);
    sent++;
    console.log(`    -> da gui: thanh cong=${res.successCount} that bai=${res.failureCount}`);
    res.responses.forEach((r, i) => { if (!r.success) console.log(`       loi[${i}]: ${r.error && r.error.code}`); });
  }
  console.log(`Done. today=${today} hour=${nowH} sent=${sent}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
