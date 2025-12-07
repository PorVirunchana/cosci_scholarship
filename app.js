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
    // ดึงรหัสบัวศรีจาก session (student login)
    const buasri = req.session.user.stu_buasri;
    const stu_id = req.session.user.stu_id;

    //ดึงข้อมูลผู้ใช้
        db.query("SELECT * FROM account WHERE stu_buasri = ?", [buasri], (err, userResults) => {
        if (err || userResults.length === 0) {
            req.session.destroy();
            return res.redirect("/login");
        }

        const user = userResults[0];

        // 1) ดึงข้อมูลนิสิต + advisor
        const queryStudent = `
            SELECT stu_id, stu_name, stu_advisor
            FROM student
            WHERE stu_id = ?
        `;

        db.query(queryStudent, [stu_id], (err, studentResult) => {
        if (err) return res.status(500).send("Error fetching student data");
        if (studentResult.length === 0) return res.status(404).send("Student not found");

        const student = studentResult[0];
        const advisorId = student.stu_advisor;

        // 2) ดึงชื่ออาจารย์จากตาราง staff
        const queryAdvisor = `
            SELECT staff_name
            FROM staff
            WHERE staff_id = ?
        `;

        db.query(queryAdvisor, [advisorId], (err, staffResult) => {
            if (err) return res.status(500).send("Error fetching advisor data");

            const adviserName = staffResult.length > 0 ? staffResult[0].staff_name : "ไม่พบข้อมูลอาจารย์";

            // 3) user object รวมข้อมูลทั้งหมด (เอา major จาก register)
            const user = {
                stu_id: student.stu_id,
                stu_name: student.stu_name,
                stu_major: req.session.user.stu_major, 
                adviser_name: adviserName
            };

        // 4) Query ทุนใหม่ 3 ประเภท
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
            JOIN scholarship_awardees aw ON ac.stu_id = aw.stu_id
            JOIN scholarship_detail sd ON aw.scholarship_id = sd.scholarship_id
            WHERE ac.stu_id = ?
            
            UNION
            
            SELECT 'กู้ยืมเพื่อการศึกษา (กยศ.)' AS scholarship_name, slf_year AS scholarship_year, slf_amount AS scholarship_amount
            FROM slf_detail
            WHERE stu_id = ? AND slf_pending = 1

            ORDER BY scholarship_year DESC
        `;

            db.query(sqlHistory, [stu_id, stu_id], (err, historyResults) => {
                if (err) return res.status(500).send("Error fetching history");
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

//หน้า ผู้ได้รับทุนการศึกษา
app.get("/awardees", (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const sql = `
        SELECT 
            a.awardee_id,
            a.scholarship_id,
            s.scholarship_name,
            s.scholarship_type,
            s.scholarship_year,
            a.stu_name,
            a.maj_id,
            m.maj_th_name
        FROM scholarship_awardees a
        JOIN scholarship_detail s ON a.scholarship_id = s.scholarship_id
        LEFT JOIN major m ON a.maj_id = m.maj_id -- join กับตาราง major
        ORDER BY a.awardee_id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Database error in /awardees:", err);
            return res.status(500).send("Database Error");
        }

        // ส่งชื่อสาขาไปใช้ใน EJS
        res.render("awardees", { 
            awardees: results.map(item => ({
                ...item,
                stu_major: item.maj_th_name || '-' // ใช้ชื่อสาขา หรือ '-' ถ้าไม่เจอ
            })), 
            user: req.session.user 
        });
    });
});



// ✅ หน้า Student Loan (กยศ.)
app.get("/student_loan", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const user = req.session.user;

    // 1. ดึงข้อมูลสถานะล่าสุดของนิสิตคนนี้
    const sqlMyStatus = "SELECT * FROM slf_detail WHERE stu_id = ? ORDER BY slf_year DESC LIMIT 1";

    // 2. ดึงข้อมูลสถิติภาพรวม (นับจำนวน status 0, 1, 2 ในแต่ละปี)
    const sqlStats = `
        SELECT slf_year, slf_pending, COUNT(*) as count 
        FROM slf_detail 
        GROUP BY slf_year, slf_pending 
        ORDER BY slf_year DESC
    `;

    db.query(sqlMyStatus, [user.stu_id], (err, myStatusResult) => {
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

    const buasri = req.session.user.stu_buasri;

    // ดึงข้อมูลจาก account
    db.query("SELECT * FROM account WHERE stu_buasri = ?", [buasri], (err, accountResults) => {
        if (err || accountResults.length === 0) {
            req.session.destroy();
            return res.redirect("/login");
        }

        const account = accountResults[0];

        // ดึงข้อมูล stu_advisor จากตาราง student
        db.query("SELECT stu_advisor FROM student WHERE stu_id = ?", [account.stu_id], (err, studentResults) => {
            if (err) return res.status(500).send("Error fetching student data");

            const advisorId = studentResults.length > 0 ? studentResults[0].stu_advisor : null;

            // ดึงชื่ออาจารย์จาก staff
            db.query("SELECT staff_name FROM staff WHERE staff_id = ?", [advisorId], (err, staffResults) => {
                if (err) return res.status(500).send("Error fetching advisor data");

                const adviserName = staffResults.length > 0 ? staffResults[0].staff_name : "-";

                // รวมข้อมูลทั้งหมดลงใน user object
                const user = {
                    stu_id: account.stu_id,
                    stu_name: account.stu_name,
                    stu_email: account.stu_email,
                    faculty: account.faculty,
                    stu_major: account.stu_major,
                    adviser_name: adviserName,
                };

                res.render("profile", { user });
            });
        });
    });
});


app.get("/forgot", (req, res) => {
    res.render("forgot_password"); 
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get("/staff", (req, res) => {
  // ตรวจสอบว่าล็อกอินหรือไม่ และเป็น staff หรือไม่
  if (!req.session.user || req.session.role !== 'staff') {
      return res.redirect("/login");
  }

  // ส่งตัวแปร user ไปยังหน้าจอ
  res.render("staff_dashboard", { 
      user: req.session.user 
  }); 
});

app.get("/staffmanage", (req, res) => {
  // 1. ตรวจสอบสิทธิ์ (ต้องล็อกอินและเป็น staff)
  if (!req.session.user || req.session.role !== 'staff') {
      return res.redirect("/login");
  }

  // 2. SQL Query: ดึงข้อมูล 3 ประเภท ประเภทละ 1 ทุน ของปี 2567
  const sql = `
      (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนภายในมหาวิทยาลัย' LIMIT 1)
      UNION
      (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนภายในวิทยาลัยนวัตกรรมสื่อสารสังคม' LIMIT 1)
      UNION
      (SELECT * FROM scholarship_detail WHERE scholarship_year = 2567 AND scholarship_type = 'ทุนจากหน่วยงานภายนอก' LIMIT 1)
  `;

  db.query(sql, (err, results) => {
      if (err) {
          console.error("Error fetching manage scholarships:", err);
          return res.status(500).send("Database Error");
      }

      // 3. ส่งข้อมูลไปที่หน้าจอ (สำคัญมาก! บรรทัดนี้แก้ Error)
      res.render("staff_manage_scholarships", { 
          user: req.session.user,      
          scholarships: results        // ✅ ต้องส่งตัวแปรนี้ไป ไม่งั้นหน้าเว็บจะหาไม่เจอ
      }); 
  });
});

app.get("/staffapprove", (req, res) => {
  res.render("staff_approve_loan"); 
});

// --- API ROUTES ---

app.post("/register", (req, res) => {
    const { stu_id, stu_buasri, stu_name, stu_eng_name, stu_email, stu_group, stu_major, stu_pass } = req.body;

    // 1) เช็ค stu_buasri ว่ามีใน student ไหม
    db.query(
        "SELECT * FROM student WHERE stu_buasri = ?",
        [stu_buasri],
        (err, checkBuasri) => {
        if (err) return res.json({ success: false, message: "DB Error 1" });

        if (checkBuasri.length === 0) {
            return res.json({
            success: false,
            message: "ไม่พบรหัสบัวศรีนี้ในระบบนิสิต"
            });
        }

        // 2) เช็ค duplicate ใน account
        db.query(
            "SELECT * FROM account WHERE stu_email = ? OR stu_id = ? OR stu_buasri = ?",
            [stu_email, stu_id, stu_buasri],
            (err, checkAccount) => {
            if (err) return res.json({ success: false, message: "DB Error 2" });

            if (checkAccount.length > 0) {
                return res.json({
                success: false,
                message: "อีเมล/รหัสนิสิต/รหัสบัวศรีนี้ ถูกใช้แล้ว"
                });
            }

            // 3) hash password → bcrypt ต้องใช้ callback เช่นกัน
            bcrypt.hash(stu_pass, 10, (err, hashedPassword) => {
                if (err) return res.json({ success: false, message: "Hash Error" });

                // 4) insert account
                db.query(
                `INSERT INTO account 
                    (stu_id, stu_buasri, stu_name, stu_eng_name, stu_email, stu_group, stu_major, stu_pass)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [stu_id, stu_buasri, stu_name, stu_eng_name, stu_email, stu_group, stu_major, hashedPassword],
                (err, result) => {
                    if (err) {
                    console.error(err);
                    return res.json({
                        success: false,
                        message: "เกิดข้อผิดพลาดในระบบ"
                    });
                    }

                    return res.json({
                    success: true,
                    message: "สมัครสำเร็จ"
                    });
                }
                );
            });
            }
        );
        }
    );
    });


// ✅ LOGIN SYSTEM: รองรับทั้ง Student และ Staff
app.post("/login", (req, res) => {
    const { buasri, password } = req.body;

  // 1. ตรวจสอบในตาราง account (นิสิต) ก่อน
  db.query("SELECT * FROM account WHERE stu_buasri=?", [buasri], async (err, studentResults) => {
    if (err) {
        console.error(err);
        return res.render("login", { message: "Database Error" });
    }

    // --- กรณีเป็นนิสิต ---
    if (studentResults.length > 0) {
        const user = studentResults[0];
        const match = await bcrypt.compare(password, user.stu_pass);
        if (!match) return res.render("login", { message: "❌ รหัสผ่านไม่ถูกต้อง" });
    
        req.session.user = user;
        req.session.role = 'student'; // กำหนด Role
        return res.redirect("/dashboard");
    }

    // 2. ถ้าไม่เจอนิสิต -> ตรวจสอบในตาราง staff (เจ้าหน้าที่)
    // ใช้ email ที่กรอกมาเทียบกับ staff_buasri
    db.query("SELECT * FROM staff WHERE staff_buasri=?", [buasri], async (err, staffResults) => {
        if (err) {
            console.error(err);
            return res.render("login", { message: "Database Error" });
        }

        // --- กรณีเป็น Staff ---
        if (staffResults.length > 0) {
            const staff = staffResults[0];
            
            // ตรวจสอบรหัสผ่าน (สมมติว่าเป็น Plain text ตามโค้ดเดิมของคุณ)
            // ถ้าใน DB เก็บแบบ Hash ให้เปลี่ยนเป็น bcrypt.compare เหมือนของนิสิต
            if (password !== staff.staff_pass) {
                 return res.render("login", { message: "❌ รหัสผ่านเจ้าหน้าที่ไม่ถูกต้อง" });
            }

            // ✅ บันทึกข้อมูลลง Session
            req.session.user = staff;
            req.session.role = 'staff'; 
            
            return res.redirect("/staff"); 
        }

        // 3. ไม่เจอทั้งคู่
        return res.render("login", { message: "❌ ไม่พบข้อมูลผู้ใช้งานในระบบ" });
    });
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

// ตัวอย่าง Route สำหรับรับค่าจากฟอร์มเพิ่มทุน
app.post("/add_scholarship", (req, res) => {
    const {
        scholarship_id,
        scholarship_name, 
        scholarship_year, 
        scholarship_amount, 
        scholarship_type, 
        apply_duration
    } = req.body;

    const sql = `INSERT INTO scholarship_detail 
                (scholarship_id, scholarship_name, scholarship_year, scholarship_amount, scholarship_type, apply_duration)
                VALUES (?, ?, ?, ?, ?, ?)`;
                
    db.query(sql, [scholarship_id, scholarship_name, scholarship_year, scholarship_amount, scholarship_type, apply_duration], (err, result) => {
        if (err) {
            console.error("เกิดข้อผิดพลาดในการบันทึกข้อมูล:", err);
            return res.status(500).send("Database Error: " + err.message);
        }
        // 4. บันทึกสำเร็จ ให้รีเฟรชกลับไปหน้า staffmanage
        console.log("บันทึกข้อมูลทุนสำเร็จ!");
        res.redirect("/staffmanage");
    });
});

app.get('/api/session', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ username: req.session.user.fullname, email: req.session.user.email });
  }
  res.json({});
});

app.listen(3000, () => console.log("🚀 Server running at http://localhost:3000"));