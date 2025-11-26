const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");
const nodemailer = require('nodemailer');
const app = express();
const moment = require('moment'); // สำหรับจัดการวันที่
const requestIp = require('request-ip'); // สำหรับดึง IP Address

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, 'public'))); // กำหนดโฟลเดอร์สำหรับไฟล์ Static (CSS, JS, Images)
app.use(requestIp.mw()); // Middleware สำหรับดึง IP

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(session({
  secret: "mySecretKey",
  resave: false,
  saveUninitialized: false,
}));

// Database connection
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "web",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

db.getConnection((err, connection) => {
  if (err) {
    console.error('MySQL connection error:', err);
    throw err;
  }
  console.log('✅ Connected to MySQL Database: web (pool)');
  connection.release();
});

// sendmail
function sendmail(toemail, subject, html) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'nongnaphat.ni04@gmail.com',
      pass: 'ojap tiuj tkta goon'
    }
  });
  transporter.sendMail({ from: 'nongnaphat.ni04@gmail.com', to: toemail, subject, html }, (err, info) => {
    if(err) console.log(err);
    else console.log('Email sent:', info.response);
  });
}

// OTP store for forgot password
let otpStore = {}; 
let tempPasswordActive = {};

// หน้าแรก
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views/login.html"));
});

// หน้า Register
app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "views/register.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "views/dashboard.html"));
});

app.get("/scholarships", (req, res) => {
  res.sendFile(path.join(__dirname, "views/scholarships.html"));
});

app.get("/profile", (req, res) => {
  res.sendFile(path.join(__dirname, "views/profile.html"));
});

// Logout route
app.get('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      // ignore err and redirect to login
      res.redirect('/login');
    });
  } else {
    res.redirect('/login');
  }
});

// Register
app.post("/register", async (req, res) => {
  const { email, username, password } = req.body;

  db.query("SELECT * FROM accounts WHERE email=?", [email], async (err, results) => {
    if(err) return res.send("Database error");
    if(results.length > 0) return res.send("❌ Email นี้ถูกใช้แล้ว");

    const hashedPassword = await bcrypt.hash(password, 10);
    db.query("INSERT INTO accounts (email, username, password) VALUES (?, ?, ?)", [email, username, hashedPassword], err => {
      if(err) return res.send("Database error");
      res.send("✅ สมัครสมาชิกสำเร็จ! <a href='/login'>ไปล็อกอิน</a>");
    });
  });
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views/login.html"));
});

// Login
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM accounts WHERE email=?", [email], async (err, results) => {
    if(err) {
      console.error('Login DB error:', err);
      return res.send("Database error (check server log)");
    }
    if(results.length === 0) {
      return res.render("login", { message: "❌ Email ไม่พบในระบบ. ลงทะเบียนใหม่ <a href='/register'>คลิกที่นี่</a>" });
    }

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if(!match) return res.render("login", { message: "❌ รหัสผ่านไม่ถูกต้อง" });

    req.session.user = user;
    // If this account was assigned a temporary password, require change on next use
    if (tempPasswordActive[user.email]) {
      req.session.mustChangePassword = true;
    } else {
      req.session.mustChangePassword = false;
    }
    res.redirect("/dashboard");
  });
});


// Forgot Password
// หน้า Forgot
app.get("/forgot", (req, res) => {
  res.render("forgot_password", { step: 1, message: "" });
});

// ส่ง OTP + temporary password
app.post("/forgot", (req, res) => {
  const { email } = req.body;
  db.query("SELECT * FROM accounts WHERE email=?", [email], async (err, results) => {
    if(err) return res.send("Database error");
    if(results.length === 0) return res.render("forgot_password", { step: 1, message: "❌ Email ไม่พบในระบบ" });

    const otp = Math.floor(100000 + Math.random()*900000).toString();
    const tempPassword = Math.random().toString(36).substring(2,10);
    const hashedTemp = await bcrypt.hash(tempPassword, 10);

    otpStore[email] = { code: otp, expires: Date.now() + 10*60*1000 };

    db.query("UPDATE accounts SET password=? WHERE email=?", [hashedTemp, email], () => {
      const html = `<h3>OTP: <strong>${otp}</strong></h3><p>Temporary password: <strong>${tempPassword}</strong></p>`;
      sendmail(email, "Password Reset OTP", html);
      // mark this account as having a temp password that must be changed on next login
      tempPasswordActive[email] = true;
      res.render("forgot_password", { step: 2, message: "ระบบส่ง OTP ไปที่อีเมลของคุณแล้ว", email });
    });
  });
});

// Verify OTP
app.post("/forgot/verify", (req, res) => {
  const { email, otp } = req.body;
  if(!otpStore[email] || Date.now() > otpStore[email].expires) {
    return res.render("forgot_password", { step: 2, message: "❌ OTP หมดอายุ", email });
  }
  if(otpStore[email].code !== otp) {
    return res.render("forgot_password", { step: 2, message: "❌ OTP ไม่ถูกต้อง", email });
  }

  delete otpStore[email];
  res.send(`<script>alert('OTP ถูกต้อง! ใช้รหัสชั่วคราวล็อกอินได้เลย'); window.location.href='/login';</script>`);
});

// API ENDPOINTS
// ตรวจว่าใครล็อกอินอยู่
app.get('/api/session', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ 
      username: req.session.user.username, 
      email: req.session.user.email, 
      mustChangePassword: !!req.session.mustChangePassword 
    });
  }
  res.json({});
});

app.get('/debug/db', (req, res) => {
  db.query('SELECT 1+1 AS sum', (err, results) => {
    if (err) {
      console.error('DB debug error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
    res.json({ ok: true, result: results[0] });
  });
});

// ฟังก์ชัน Utility สำหรับ Query DB
async function query(sql, params) {
    const [rows] = await db.execute(sql, params);
    return rows;
}

// 3. Route สำหรับหน้าแรก ('/')
app.get('/', async (req, res) => {
    const today = moment().format('YYYY-MM-DD');
    const clientIp = req.clientIp;
    let flagshipProducts = [];
    let todayVisits = 0;
    let totalVisits = 0;

    // --- A. Logic: Counter นับผู้เข้าชม (1 IP ต่อ 1 วัน) ---
    try {
        // ตรวจสอบว่า IP นี้เคยเข้าชมวันนี้แล้วหรือยัง
        const countQuery = 'SELECT * FROM counter WHERE ip_address = ? AND visit_date = ?';
        const existingVisit = await query(countQuery, [clientIp, today]);

        if (existingVisit.length === 0) {
            // ถ้ายังไม่เคยเข้าชมวันนี้ ให้เพิ่มลงในตาราง counter
            const insertQuery = 'INSERT INTO counter (ip_address, visit_date) VALUES (?, ?)';
            await query(insertQuery, [clientIp, today]);
        }
        
        // ดึงจำนวนผู้เข้าชมวันนี้ (Unique IP)
        const totalToday = await query('SELECT COUNT(DISTINCT ip_address) as count FROM counter WHERE visit_date = ?', [today]);
        todayVisits = totalToday[0].count;

        // ดึงจำนวนผู้เข้าชมทั้งหมด
        const totalAll = await query('SELECT COUNT(*) as total FROM counter');
        totalVisits = totalAll[0].total;

    } catch (error) {
        console.error('Error handling counter:', error);
        // หากมีข้อผิดพลาด ให้ออกค่าเป็น 0
    }

    // --- B. Logic: ดึงสินค้า Flagship จากฐานข้อมูล ---
    try {
        // is_flagship = 1 หมายถึงสินค้า Flagship
        const productQuery = 'SELECT * FROM smartwatch_products WHERE is_flagship = 1 ORDER BY brand';
        flagshipProducts = await query(productQuery);
    } catch (error) {
        console.error('Error fetching flagship products:', error);
    }

    // 4. แสดงผล Template (index.ejs)
    res.render('index', { 
        products: flagshipProducts,
        todayVisits: todayVisits,
        totalVisits: totalVisits,
        user: req.session.user || null // Placeholder: สำหรับการแสดงชื่อสมาชิกเมื่อ Login แล้ว
    });
});

// ---------------- Start Server -----------------
app.listen(3000, () => console.log("🚀 Server running at http://localhost:3000"));