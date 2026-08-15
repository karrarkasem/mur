# مُر OCPP Server

سيرفر يستقبل اتصال محطات الشحن الحقيقية عبر **OCPP 1.6J** (WebSocket)، ويحدّث نفس مستندات Firestore اللي تعرضها صفحات إدارة الشحن بالموقع (`ev-dashboard.html`, `ev-chargers.html`) — بدون أي تعديل على الواجهة.

هذي الجولة تدعم بس: `BootNotification`, `Heartbeat`, `StatusNotification` (يعني: المحطة تتصل، وتصير تظهر Online وحالة الموصلات تتحدث لحظيًا بالوحة التحكم). جلسات الشحن الحقيقية (`Authorize`/`StartTransaction`/`MeterValues`/`StopTransaction`) مرحلة تالية.

## الإعداد (مرة وحدة)

### 1. Firebase Service Account
1. Firebase Console → ⚙️ Project Settings → **Service Accounts**
2. **Generate new private key** → يتنزل ملف JSON فيه `client_email` و`private_key`
3. لا ترفع هذا الملف لأي مكان — بس تحتاج القيمتين هاي بالخطوة الجاية

### 2. حساب Cloudflare
1. أنشئ حساب مجاني على [cloudflare.com](https://dash.cloudflare.com/sign-up) إذا ماكو عندك
2. My Profile → **API Tokens** → Create Token → استخدم قالب **"Edit Cloudflare Workers"**
3. احفظ الـToken، وخذ **Account ID** (يطلع بالصفحة الرئيسية بالداشبورد)

### 3. أسرار GitHub (للنشر التلقائي)
بمستودع المشروع على GitHub: Settings → Secrets and variables → Actions → أضف:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

أي push يغيّر شي داخل `ocpp-server/` رح ينشر تلقائيًا عبر `.github/workflows/deploy-ocpp.yml`.

### 4. أسرار Cloudflare Worker (بيانات Firebase)
هذي لازم تنضاف مرة وحدة يدويًا من جهازك (ما تنكتب بأي ملف بالمستودع):

```bash
cd ocpp-server
npm install
npx wrangler login
npx wrangler secret put FIREBASE_CLIENT_EMAIL
# الصق قيمة client_email من ملف JSON

npx wrangler secret put FIREBASE_PRIVATE_KEY
# الصق قيمة private_key كاملة (تبدأ بـ -----BEGIN PRIVATE KEY-----)
```

### 5. أول نشر يدوي (اختياري، للتجربة قبل أول push)
```bash
npx wrangler deploy
```
راح يطلعلك رابط الـWorker (مثلاً `https://mur-ocpp-server.<اسمك>.workers.dev`).

## التحقق بدون جهاز حقيقي
استخدم أي محاكي OCPP 1.6J مجاني (متوفرة أونلاين) واتصل بـ:
```
wss://<رابط-الـWorker>/ocpp/<ocppId الموجود بصفحة المحطات>
```
مع تحديد Subprotocol = `ocpp1.6`. أرسل `BootNotification` ثم `StatusNotification` — وشوف صفحة `ev-chargers.html` تتحدث لحالها.

## مراقبة السيرفر
```bash
npx wrangler tail
```
يعرض لوگ حي لكل رسالة توصل من أي محطة متصلة.
