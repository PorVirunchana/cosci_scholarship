const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");
const nodemailer = require('nodemailer');
const app = express();
const requestIp = require('request-ip'); 
const moment = require('moment'); // ✅ จำเป็นสำหรับ Counter
require("dotenv").config();


app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, 'public')));
app.use(requestIp.mw()); 

app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static("public"));
app.use(session({
  secret: "gwapor322466",
  resave: false,
  saveUninitialized: false,
}));

// Database connection
const db = mysql.createPool({
   host: process.env.DB_HOST,
   user: process.env.DB_USER,
   password: process.env.DB_PASS,
   database: process.env.DB_NAME,
   port: process.env.DB_PORT,
   // เพิ่มค่าเพื่อทดสอบ Pool ทันที (optional)
   waitForConnections: true, 
   connectionLimit: 1 
});

// ✅ เพิ่มโค้ดส่วนนี้เพื่อดักจับ Log การเชื่อมต่อ
db.on('connection', (connection) => {
    console.log('✅ Connection Pool: ได้สร้างการเชื่อมต่อใหม่แล้ว');
    // หากต้องการใช้ connection นี้เพื่อตรวจสอบอย่างอื่น สามารถทำได้
    // connection.ping((err) => { ... });
});

db.on('error', (err) => {
    console.error('❌ Connection Pool Error (Fatal):', err);
    // กรณีที่เกิดข้อผิดพลาดร้ายแรงกับ Pool
});

// ==========================================
// 🔥 Middleware: Counter (แก้ไขแล้ว) 🔥
// ==========================================
app.use(async (req, res, next) => {
    try {
        const clientIp = requestIp.getClientIp(req);
        const today = moment().format('YYYY-MM-DD');

        console.log(`👀 มีผู้เข้าชม! IP: ${clientIp} | วันที่: ${today}`);

        // INSERT IGNORE
        const [insertRes] = await promisePool.query(
            'INSERT IGNORE INTO counter (ip_address, visit_date) VALUES (?, ?)',
            [clientIp, today]
        );

        if (insertRes.affectedRows > 0) {
            console.log("✅ บันทึก IP ใหม่สำเร็จ!");
        } else {
            console.log("⚠️ IP นี้เข้าชมแล้ว (ข้ามการบันทึก)");
        }

        // ยอดวันนี้
        const [todayRes] = await promisePool.query(
            'SELECT COUNT(*) as count FROM counter WHERE visit_date = ?',
            [today]
        );

        // ยอดรวม
        const [totalRes] = await promisePool.query(
            'SELECT COUNT(*) as count FROM counter'
        );

        console.log(`📊 สถิติ -> วันนี้: ${todayRes[0].count} | รวม: ${totalRes[0].count}`);

        res.locals.visitorStats = {
            today: todayRes[0].count,
            total: totalRes[0].count
        };

    } catch (err) {
        console.error("❌ Counter Error:", err);
        res.locals.visitorStats = { today: 0, total: 0 };
    }

    next();
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

// ✅ GET REGISTER: ส่ง Major และ Staff ไปทำ Dropdown
app.get("/register", (req, res) => {
    db.query("SELECT * FROM major", (err, majors) => {
        if (err) { console.error(err); return res.send("Database Error (Major)"); }

        db.query("SELECT * FROM staff", (err, staffs) => {
            if (err) { console.error(err); return res.send("Database Error (Staff)"); }

            res.render("register", { majors: majors, staffs: staffs }); 
        });
    });
});

// ✅ DASHBOARD
app.get("/dashboard", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const buasri = req.session.user.stu_buasri;
    const stu_id = req.session.user.stu_id;

    // 1. Join Major เพื่อเอาชื่อสาขา (maj_th_name)
    const sqlStudent = `
        SELECT student.*, major.maj_th_name 
        FROM student 
        LEFT JOIN major ON student.stu_major = major.maj_id 
        WHERE student.stu_buasri = ?
    `;

    db.query(sqlStudent, [buasri], (err, userResults) => {
        if (err || userResults.length === 0) {
            req.session.destroy();
            return res.redirect("/login");
        }

        const student = userResults[0];

        // 2. หาชื่ออาจารย์จาก staff table
        const queryAdvisor = `SELECT staff_name FROM staff WHERE staff_id = ?`;
        db.query(queryAdvisor, [student.stu_advisor], (err, staffResult) => {
            const adviserName = (staffResult && staffResult.length > 0) ? staffResult[0].staff_name : "-";

            const user = {
                stu_id: student.stu_id,
                stu_name: student.stu_name,
                stu_major: student.maj_th_name || '-', // ใช้ชื่อสาขาภาษาไทย
                adviser_name: adviserName
            };

            // 3. ทุนใหม่
            const sqlNew = `
                (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนภายในมหาวิทยาลัย' LIMIT 1)
                UNION
                (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนภายในวิทยาลัยนวัตกรรมสื่อสารสังคม' LIMIT 1)
                UNION
                (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนจากหน่วยงานภายนอก' LIMIT 1)
            `;

            db.query(sqlNew, (err, newScholarships) => {
                // 4. ประวัติทุน
                const sqlHistory = `
                    SELECT sd.scholarship_name, sd.scholarship_year, sd.scholarship_amount
                    FROM student ac
                    JOIN scholarship_awardees aw ON ac.stu_id = aw.stu_id
                    JOIN scholarship_detail sd ON aw.scholarship_id = sd.scholarship_id
                    WHERE ac.stu_id = ?
                    UNION
                    SELECT 'กู้ยืมเพื่อการศึกษา (กยศ.)' AS scholarship_name, slf_year AS scholarship_year, slf_amount AS scholarship_amount
                    FROM slf_detail WHERE stu_id = ? AND slf_pending = 1
                    ORDER BY scholarship_year DESC
                `;

                db.query(sqlHistory, [stu_id, stu_id], (err, historyResults) => {
                    // ส่ง visitorStats ไปด้วย (จริงๆ มันอยู่ใน locals แล้ว แต่ส่งซ้ำก็ไม่เสียหาย)
                    res.render("dashboard", { 
                        user: user,
                        newScholarships: newScholarships || [],
                        history: historyResults || [] 
                    });
                });
            });
        });
    });
});

app.get("/scholarships", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const sql = `SELECT * FROM scholarship_detail ORDER BY scholarship_year DESC`;
    db.query(sql, (err, results) => {
        if (err) return res.send("Database Error");
        
        const targetYears = [2567, 2566, 2565];
        const stats = targetYears.map(year => {
            const sInYear = results.filter(s => s.scholarship_year == year);
            const sumApplicants = sInYear.reduce((sum, item) => sum + (item.total_applicants || 0), 0);
            const sumAwardees = sInYear.reduce((sum, item) => sum + (item.total_awardees || 0), 0);
            return { year, count: sInYear.length, total_applicants: sumApplicants, total_awardees: sumAwardees };
        });

        res.render("scholarships", { scholarships: results, stats: stats, user: req.session.user });
    });
});

app.get("/awardees", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const sql = `
        SELECT a.awardee_id, a.scholarship_id, s.scholarship_name, s.scholarship_type, s.scholarship_year,
               a.stu_name, a.maj_id, m.maj_th_name
        FROM scholarship_awardees a
        JOIN scholarship_detail s ON a.scholarship_id = s.scholarship_id
        LEFT JOIN major m ON a.maj_id = m.maj_id
        ORDER BY a.awardee_id DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).send("Database Error");
        res.render("awardees", { 
            awardees: results.map(item => ({ ...item, stu_major: item.maj_th_name || '-' })), 
            user: req.session.user 
        });
    });
});

app.get("/student_loan", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const user = req.session.user;
    const sqlMyStatus = "SELECT * FROM slf_detail WHERE stu_id = ? ORDER BY slf_year DESC LIMIT 1";
    const sqlStats = `SELECT slf_year, slf_pending, COUNT(*) as count FROM slf_detail GROUP BY slf_year, slf_pending ORDER BY slf_year DESC`;

    db.query(sqlMyStatus, [user.stu_id], (err, myStatusResult) => {
        const myLoan = myStatusResult.length > 0 ? myStatusResult[0] : null;
        db.query(sqlStats, (err, statsResult) => {
            let statsMap = {};
            if(statsResult) {
                statsResult.forEach(row => {
                    if(!statsMap[row.slf_year]) statsMap[row.slf_year] = { pending: 0, pass: 0, fail: 0 };
                    if(row.slf_pending == 0) statsMap[row.slf_year].pending = row.count;
                    if(row.slf_pending == 1) statsMap[row.slf_year].pass = row.count;
                    if(row.slf_pending == 2) statsMap[row.slf_year].fail = row.count;
                });
            }
            res.render("student_loan", { user: user, myLoan: myLoan, stats: statsMap });
        });
    });
});

// ✅ PROFILE
app.get("/profile", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const buasri = req.session.user.stu_buasri;

    // Join Major
    const sqlStudent = `
        SELECT student.*, major.maj_th_name 
        FROM student 
        LEFT JOIN major ON student.stu_major = major.maj_id 
        WHERE student.stu_buasri = ?
    `;

    db.query(sqlStudent, [buasri], (err, r) => {
        if (err || r.length === 0) { req.session.destroy(); return res.redirect("/login"); }
        const s = r[0];
        
        // Join Staff
        db.query("SELECT staff_name FROM staff WHERE staff_id = ?", [s.stu_advisor], (err, st) => {
            const adviserName = (st && st.length > 0) ? st[0].staff_name : "-";
            const user = {
                stu_id: s.stu_id,
                stu_name: s.stu_name,
                stu_email: s.stu_email,
                stu_major: s.maj_th_name || '-',
                adviser_name: adviserName,
            };
            res.render("profile", { user });
        });
    });
});

app.get("/forgot", (req, res) => { res.render("forgot_password"); });
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

// STAFF ROUTES
app.get("/staff", (req, res) => {
  if (!req.session.user || req.session.role !== 'staff') return res.redirect("/login");
  res.render("staff_dashboard", { user: req.session.user }); 
});

app.get("/staffmanage", (req, res) => {
    if (!req.session.user || req.session.role !== 'staff') return res.redirect("/login");
    const sql = `
        (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนภายในมหาวิทยาลัย' LIMIT 1)
        UNION
        (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนภายในวิทยาลัยนวัตกรรมสื่อสารสังคม' LIMIT 1)
        UNION
        (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนจากหน่วยงานภายนอก' LIMIT 1)
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).send("DB Error");
        res.render("staff_manage_scholarships", { user: req.session.user, scholarships: results }); 
    });
});

app.get("/staffapprove", (req, res) => { res.render("staff_approve_loan"); });

// --- API ROUTES ---

// ✅ REGISTER
app.post("/register", (req, res) => {
    const { stu_id, stu_buasri, stu_name, stu_eng_name, stu_email, stu_group, stu_major, stu_pass, stu_advisor } = req.body;
    
    // Check Duplicate
    db.query("SELECT * FROM student WHERE stu_buasri = ? OR stu_id = ? OR stu_email = ?", [stu_buasri, stu_id, stu_email], (err, check) => {
        if (err) return res.json({ success: false, message: "DB Error" });
        if (check.length > 0) return res.json({ success: false, message: "ข้อมูลซ้ำ (รหัสนิสิต/บัวศรี/อีเมล)" });
        
        // Hash & Insert
        bcrypt.hash(stu_pass, 10, (err, hash) => {
            if (err) return res.json({ success: false, message: "Hash Error" });
            const sql = `INSERT INTO student (stu_id, stu_buasri, stu_name, stu_eng_name, stu_email, stu_group, stu_major, stu_advisor, stu_pass) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            db.query(sql, [stu_id, stu_buasri, stu_name, stu_eng_name, stu_email, stu_group, stu_major, stu_advisor, hash], (err, result) => {
                if (err) { console.error(err); return res.json({ success: false, message: "Insert Error" }); }
                res.json({ success: true, message: "สมัครสำเร็จ" });
            });
        });
    });
});

// ✅ LOGIN (Bcrypt for both)
app.post("/login", (req, res) => {
    const { buasri, password } = req.body;
    
    // Check Student
    db.query("SELECT * FROM student WHERE stu_buasri=?", [buasri], async (err, result) => {
        if (err) return res.render("login", { message: "DB Error" });
        
        if (result.length > 0) {
            const user = result[0];

            if (user.stu_status !== "o") {
                return res.render("login", { message: "❌ คุณไม่มีสิทธิ์เข้าถึงระบบ" });
            }
            // ❌ ถ้า status = x → ไม่มีสิทธิ์
            const match = await bcrypt.compare(password, user.stu_pass);
            if (!match) return res.render("login", { message: "❌ รหัสผ่านไม่ถูกต้อง" });
            req.session.user = user;
            req.session.role = 'student';
            return res.redirect("/dashboard");
        }
        
        // Check Staff
        db.query("SELECT * FROM staff WHERE staff_buasri=?", [buasri], async (err, sResult) => {
            if (sResult.length > 0) {
                const staff = sResult[0];
                // ❌ ถ้า status = x → ไม่มีสิทธิ์
                if (staff.staff_status !== "o") {
                    return res.render("login", { message: "❌ คุณไม่มีสิทธิ์เข้าถึงระบบ" });
                }

                const match = await bcrypt.compare(password, staff.staff_pass);
                if (!match) return res.render("login", { message: "❌ รหัสผ่าน จนท. ผิด" });
                req.session.user = staff;
                req.session.role = 'staff';
                return res.redirect("/staff");
            }
            return res.render("login", { message: "❌ ไม่พบผู้ใช้งาน" });
        });
    });
});

// CHANGE PASSWORD
app.post("/api/change-password", async (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: "Unauthorized" });
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const email = req.session.user.stu_email;

    if (newPassword !== confirmPassword) return res.json({ success: false, message: "รหัสผ่านใหม่ไม่ตรงกัน" });

    db.query("SELECT * FROM student WHERE stu_email = ?", [email], async (err, results) => {
        if (err || results.length === 0) return res.json({ success: false, message: "User not found" });
        const user = results[0];
        const match = await bcrypt.compare(currentPassword, user.stu_pass);
        if (!match) return res.json({ success: false, message: "รหัสผ่านเดิมไม่ถูกต้อง" });
        
        const hashed = await bcrypt.hash(newPassword, 10);
        db.query("UPDATE student SET stu_pass = ? WHERE stu_email = ?", [hashed, email], (err) => {
            if (err) return res.json({ success: false, message: "DB Error" });
            res.json({ success: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" });
        });
    });
});

// FORGOT PASSWORD
let otpCache = {}; 
app.post("/api/forgot/send-otp", (req, res) => {
    const { email } = req.body;
    db.query("SELECT * FROM student WHERE stu_email = ?", [email], (err, results) => {
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
        db.query("UPDATE student SET stu_pass = ? WHERE stu_email = ?", [hashedPassword, email], () => {
            delete otpCache[email]; 
            res.json({ success: true, message: "เปลี่ยนรหัสสำเร็จ" });
        });
    } catch (e) { res.json({ success: false, message: "Server Error" }); }
});

// ADD SCHOLARSHIP (Staff)
app.post("/add_scholarship", (req, res) => {
    const { scholarship_id, scholarship_name, scholarship_year, scholarship_amount, scholarship_type, apply_duration } = req.body;
    const sql = `INSERT INTO scholarship_detail (scholarship_id, scholarship_name, scholarship_year, scholarship_amount, scholarship_type, apply_duration) VALUES (?, ?, ?, ?, ?, ?)`;   
    db.query(sql, [scholarship_id, scholarship_name, scholarship_year, scholarship_amount, scholarship_type, apply_duration], (err, result) => {
        if (err) { console.error("Add Error:", err); return res.status(500).send("DB Error"); }
        res.redirect("/staffmanage");
    });
});

app.get('/api/session', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ username: req.session.user.stu_name || req.session.user.staff_name });
  }
  res.json({});
});

const PORT = process.env.PORT || 3000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});