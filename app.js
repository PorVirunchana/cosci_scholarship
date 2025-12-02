const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");
const nodemailer = require('nodemailer');
const app = express();
const moment = require('moment'); 
const requestIp = require('request-ip'); 

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, 'public')));
app.use(requestIp.mw()); 

app.use(bodyParser.json()); 
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
  database: "swu_scholarship",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

db.getConnection((err, connection) => {
  if (err) {
    console.error('MySQL connection error:', err);
    throw err; 
  }
  console.log('✅ Connected to MySQL Database: swu_scholarship (pool)');
  connection.release();
});

// Sendmail function
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

// --- PAGE ROUTES ---

app.get("/", (req, res) => {
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  res.render("login", { message: null });
});

app.get("/register", (req, res) => {
  res.render("register"); 
});

// ✅ หน้า Dashboard (แก้ไขให้รวมประวัติ กยศ. ที่ผ่านแล้ว มาโชว์ด้วย)
app.get("/dashboard", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const email = req.session.user.email;

    db.query("SELECT * FROM account WHERE email = ?", [email], (err, userResults) => {
        if (err || userResults.length === 0) {
            req.session.destroy();
            return res.redirect("/login");
        }
        const user = userResults[0];

        // Query 1: ทุนใหม่ 3 ประเภท
        const sqlNew = `
            (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนภายในมหาวิทยาลัย' LIMIT 1)
            UNION
            (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนภายในวิทยาลัยนวัตกรรมสื่อสารสังคม' LIMIT 1)
            UNION
            (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนจากหน่วยงานภายนอก' LIMIT 1)
        `;

        db.query(sqlNew, (err, newScholarships) => {
            // Query 2: ประวัติรวม (ทุนปกติ + กยศ. ที่ผ่านแล้ว)
            // ใช้ UNION เพื่อรวมตาราง scholarship_detail และ slf_detail (เฉพาะที่ slf_pending = 1)
            const sqlHistory = `
                SELECT sd.scholarship_name, sd.scholarship_year, sd.scholarship_amount
                FROM account ac
                JOIN scholarship_awardees aw ON ac.student_id = aw.student_id
                JOIN scholarship_detail sd ON aw.scholarship_id = sd.scholarship_id
                WHERE ac.email = ?
                
                UNION
                
                SELECT 'กู้ยืมเพื่อการศึกษา (กยศ.)' AS scholarship_name, slf_year AS scholarship_year, slf_amount AS scholarship_amount
                FROM slf_detail
                WHERE student_id = ? AND slf_pending = 1

                ORDER BY scholarship_year DESC
            `;

            db.query(sqlHistory, [email, user.student_id], (err, historyResults) => {
                res.render("dashboard", { 
                    user: user,
                    newScholarships: newScholarships || [],
                    history: historyResults || [] 
                });
            });
        });
    });
});

app.get("/scholarships", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const sql = `
        SELECT scholarship_id, scholarship_name, scholarship_year, scholarship_type, 
               scholarship_amount, apply_duration, total_applicants, total_awardees 
        FROM scholarship_detail ORDER BY scholarship_year DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.send("Database Error");
        const targetYears = [2567, 2566, 2565];
        const stats = targetYears.map(year => {
            const scholarshipsInYear = results.filter(s => s.scholarship_year == year);
            const sumApplicants = scholarshipsInYear.reduce((sum, item) => sum + (item.total_applicants || 0), 0);
            const sumAwardees = scholarshipsInYear.reduce((sum, item) => sum + (item.total_awardees || 0), 0);
            return { year, count: scholarshipsInYear.length, total_applicants: sumApplicants, total_awardees: sumAwardees };
        });
        res.render("scholarships", { scholarships: results, stats: stats, user: req.session.user });
    });
});

// ✅ หน้า Student Loan (กยศ.)
app.get("/student_loan", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const user = req.session.user;

    // 1. ดึงข้อมูลสถานะล่าสุดของนิสิตคนนี้
    const sqlMyStatus = "SELECT * FROM slf_detail WHERE student_id = ? ORDER BY slf_year DESC LIMIT 1";

    // 2. ดึงข้อมูลสถิติภาพรวม (นับจำนวน status 0, 1, 2 ในแต่ละปี)
    const sqlStats = `
        SELECT slf_year, slf_pending, COUNT(*) as count 
        FROM slf_detail 
        GROUP BY slf_year, slf_pending 
        ORDER BY slf_year DESC
    `;

    db.query(sqlMyStatus, [user.student_id], (err, myStatusResult) => {
        if(err) console.error(err);
        const myLoan = myStatusResult.length > 0 ? myStatusResult[0] : null;

        db.query(sqlStats, (err, statsResult) => {
            if(err) console.error(err);
            
            // จัดรูปแบบข้อมูล Stats ให้ใช้ง่ายใน EJS
            // Structure: { 2567: { pending: 10, pass: 5, fail: 2 }, 2566: ... }
            let statsMap = {};
            if(statsResult) {
                statsResult.forEach(row => {
                    if(!statsMap[row.slf_year]) statsMap[row.slf_year] = { pending: 0, pass: 0, fail: 0 };
                    if(row.slf_pending == 0) statsMap[row.slf_year].pending = row.count;
                    if(row.slf_pending == 1) statsMap[row.slf_year].pass = row.count;
                    if(row.slf_pending == 2) statsMap[row.slf_year].fail = row.count;
                });
            }

            res.render("student_loan", { 
                user: user,
                myLoan: myLoan, // ข้อมูลการกู้ของฉัน
                stats: statsMap // ข้อมูลสถิติรวม
            });
        });
    });
});

app.get("/profile", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const email = req.session.user.email;
    db.query("SELECT * FROM account WHERE email = ?", [email], (err, results) => {
        if (err || results.length === 0) {
            req.session.destroy();
            return res.redirect("/login");
        }
        res.render("profile", { user: results[0] });
    });
});

app.get("/forgot", (req, res) => {
    res.render("forgot_password"); 
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- API ROUTES ---

app.post("/register", async (req, res) => {
  const { student_id, id_card, fullname, faculty, major, gpax, adviser_name, email, password, repassword } = req.body;
  if (password !== repassword) return res.json({ success: false, message: "รหัสผ่านไม่ตรงกัน" });
  db.query("SELECT * FROM account WHERE email = ? OR student_id = ?", [email, student_id], async (err, results) => {
    if (results.length > 0) return res.json({ success: false, message: "อีเมล/รหัสนิสิต ถูกใช้แล้ว" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `INSERT INTO account (student_id, id_card, fullname, email, password, faculty, major, gpax, adviser_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(sql, [student_id, id_card, fullname, email, hashedPassword, faculty, major, gpax, adviser_name], (err) => {
      if (err) return res.json({ success: false, message: "DB Error" });
      res.json({ success: true, message: "สมัครสำเร็จ" });
    });
  });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.query("SELECT * FROM account WHERE email=?", [email], async (err, results) => {
    if(err || results.length === 0) return res.render("login", { message: "❌ ไม่พบอีเมล" });
    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if(!match) return res.render("login", { message: "❌ รหัสผ่านผิด" });
    req.session.user = user;
    res.redirect("/dashboard");
  });
});

// API เปลี่ยนรหัสผ่าน
app.post("/api/change-password", async (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: "Unauthorized" });
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const email = req.session.user.email;
    if (newPassword !== confirmPassword) return res.json({ success: false, message: "รหัสผ่านใหม่ไม่ตรงกัน" });
    db.query("SELECT * FROM account WHERE email = ?", [email], async (err, results) => {
        if (err || results.length === 0) return res.json({ success: false, message: "User not found" });
        const user = results[0];
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) return res.json({ success: false, message: "รหัสผ่านเดิมไม่ถูกต้อง" });
        const hashed = await bcrypt.hash(newPassword, 10);
        db.query("UPDATE account SET password = ? WHERE email = ?", [hashed, email], (err) => {
            if (err) return res.json({ success: false, message: "Database Error" });
            res.json({ success: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" });
        });
    });
});

// Forgot Password
let otpCache = {}; 
app.post("/api/forgot/send-otp", (req, res) => {
    const { email } = req.body;
    db.query("SELECT * FROM account WHERE email = ?", [email], (err, results) => {
        if (err || results.length === 0) return res.json({ success: false, message: "ไม่พบอีเมล" });
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpCache[email] = { code: otp, expires: Date.now() + 5 * 60 * 1000 };
        sendmail(email, "รหัส OTP", `<h3>OTP: ${otp}</h3>`);
        res.json({ success: true, message: "ส่ง OTP แล้ว" });
    });
});
app.post("/api/forgot/verify-otp", (req, res) => {
    const { email, otp } = req.body;
    if (!otpCache[email] || Date.now() > otpCache[email].expires) return res.json({ success: false, message: "OTP หมดอายุ" });
    if (otpCache[email].code !== otp) return res.json({ success: false, message: "OTP ไม่ถูกต้อง" });
    res.json({ success: true, message: "OTP ถูกต้อง" });
});
app.post("/api/forgot/reset-password", async (req, res) => {
    const { email, otp, newPassword } = req.body;
    if (!otpCache[email] || otpCache[email].code !== otp) return res.json({ success: false, message: "Error" });
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.query("UPDATE account SET password = ? WHERE email = ?", [hashedPassword, email], () => {
            delete otpCache[email]; 
            res.json({ success: true, message: "เปลี่ยนรหัสสำเร็จ" });
        });
    } catch (e) { res.json({ success: false, message: "Server Error" }); }
});

app.get('/api/session', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ username: req.session.user.fullname, email: req.session.user.email });
  }
  res.json({});
});

app.listen(3000, () => console.log("🚀 Server running at http://localhost:3000"));