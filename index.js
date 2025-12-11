const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// --- CONFIGURATION ---
const CREDENTIALS = {
    username: "Kami520",
    password: "Kami526"
};

const BASE_URL = "http://51.89.99.105/NumberPanel";
const DASHBOARD_URL = `${BASE_URL}/client/SMSCDRStats`; 

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "http://51.89.99.105"
};

// --- GLOBAL STATE ---
let STATE = {
    cookie: null,
    sessKey: null,
    isLoggingIn: false,
    lastUpdate: 0
};

// --- HELPER: FIND KEY IN HTML ---
function extractKey(html) {
    // 1. سب سے عام طریقہ: لنک کے اندر (sesskey=XYZ...)
    let match = html.match(/sesskey=([^&"']+)/);
    if (match) return match[1];

    // 2. جاوا اسکرپٹ ویری ایبل (var sesskey = "XYZ")
    match = html.match(/sesskey\s*[:=]\s*["']([^"']+)["']/);
    if (match) return match[1];

    // 3. کسی اور پیٹرن میں
    match = html.match(/sesskey":"([^"]+)"/);
    if (match) return match[1];

    return null;
}

// --- 1. LOGIN & EXTRACTOR ---
async function performLogin() {
    if (STATE.isLoggingIn) return;
    STATE.isLoggingIn = true;
    
    console.log("🔄 System: Starting Login Process...");

    try {
        const instance = axios.create({ 
            withCredentials: true, 
            headers: HEADERS,
            timeout: 15000 // 15 سیکنڈ ٹائم آؤٹ
        });

        // A. Get Login Page
        const r1 = await instance.get(`${BASE_URL}/login`);
        let tempCookie = "";
        if (r1.headers['set-cookie']) {
            const c = r1.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            if (c) tempCookie = c.split(';')[0];
        }

        // B. Solve Captcha
        const match = r1.data.match(/What is (\d+) \+ (\d+) = \?/);
        if (!match) throw new Error("Captcha Not Found");
        
        const ans = parseInt(match[1]) + parseInt(match[2]);
        console.log(`🧩 Captcha Solved: ${match[1]} + ${match[2]} = ${ans}`);

        // C. Post Login
        const params = new URLSearchParams();
        params.append('username', CREDENTIALS.username);
        params.append('password', CREDENTIALS.password);
        params.append('capt', ans);

        const r2 = await instance.post(`${BASE_URL}/signin`, params, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": tempCookie,
                "Referer": `${BASE_URL}/login`
            },
            maxRedirects: 0,
            validateStatus: () => true
        });

        // D. Save Cookie
        if (r2.headers['set-cookie']) {
            const newC = r2.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            if (newC) STATE.cookie = newC.split(';')[0];
        } else {
            STATE.cookie = tempCookie;
        }
        
        console.log("✅ Login Success. Cookie:", STATE.cookie);

        // E. EXTRACT SESSKEY (The Most Important Part)
        console.log("🕵️ Hunting for SessKey on Dashboard...");
        
        const r3 = await axios.get(DASHBOARD_URL, {
            headers: { ...HEADERS, "Cookie": STATE.cookie },
            timeout: 15000
        });

        const foundKey = extractKey(r3.data);
        
        if (foundKey) {
            STATE.sessKey = foundKey;
            STATE.lastUpdate = Date.now();
            console.log("🔥 SessKey FOUND:", STATE.sessKey);
        } else {
            console.log("❌ CRITICAL: SessKey NOT found in HTML. Check Logs.");
            // ڈیبگنگ کے لیے تھوڑا سا ایچ ٹی ایم ایل پرنٹ کریں
            console.log("HTML Snippet:", r3.data.substring(0, 500)); 
        }

    } catch (e) {
        console.error("❌ Login/Extraction Failed:", e.message);
    } finally {
        STATE.isLoggingIn = false;
    }
}

// --- 2. AUTO REFRESHER ---
// ہر 2 منٹ بعد سیشن تازہ کریں
setInterval(() => {
    performLogin();
}, 120000); 

// --- 3. API SERVER ---

app.get('/', (req, res) => res.send(`🚀 API Running.<br>Cookie: ${STATE.cookie}<br>SessKey: ${STATE.sessKey}`));

app.get('/api', async (req, res) => {
    const { type } = req.query;
    
    // اگر سیشن خالی ہے تو لاگ ان کریں اور انتظار کریں
    if (!STATE.cookie || !STATE.sessKey) {
        await performLogin();
        // اگر پھر بھی نہیں ملا تو ایرر دیں (ہینگ نہ کریں)
        if (!STATE.sessKey) return res.status(500).json({error: "Server Error: Could not fetch SessKey"});
    }

    const ts = Date.now();
    let targetUrl = "";

    if (type === 'number') {
        targetUrl = `${BASE_URL}/client/res/data_smsnumbers.php?frange=&fclient=&sEcho=2&iColumns=6&sColumns=%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=${ts}`;
    } else if (type === 'sms') {
        // 🔥 SessKey یہاں استعمال ہو رہی ہے
        targetUrl = `${BASE_URL}/client/res/data_smscdr.php?fdate1=2025-12-11%2000:00:00&fdate2=2025-12-11%2023:59:59&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=${STATE.sessKey}&sEcho=2&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${ts}`;
    } else {
        return res.status(400).json({ error: "Invalid type" });
    }

    try {
        console.log(`📡 Fetching: ${type} with Key: ${STATE.sessKey}`);
        
        // Fast Request (Buffer Mode)
        const response = await axios.get(targetUrl, {
            headers: { ...HEADERS, "Cookie": STATE.cookie },
            responseType: 'arraybuffer', 
            timeout: 25000
        });

        // Validate Response
        const checkData = response.data.subarray(0, 1000).toString();
        
        if (checkData.includes('<html') || checkData.includes('login')) {
            console.log("⚠️ HTML Received (Session Died). Force Login...");
            await performLogin();
            return res.status(503).send("Session Refreshed. Try Again.");
        }

        res.set('Content-Type', 'application/json');
        res.send(response.data);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start & Login
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    performLogin();
});
