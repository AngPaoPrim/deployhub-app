const express = require("express");
const fileUpload = require("express-fileupload");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");

const app = express();
const PORT = process.env.PORT || 4000;

// ดึงค่าจาก environment variables เท่านั้น
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`;

app.use(cookieParser());
app.use(fileUpload());
app.use(express.static(__dirname));

// GitHub Login
app.get("/login", (req, res) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=repo`;
  res.redirect(githubAuthUrl);
});

// GitHub OAuth Callback
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ error: "No code provided" });
  }
  try {
    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      },
      { headers: { Accept: "application/json" } }
    );
    const token = tokenRes.data.access_token;
    if (!token) {
      return res.status(400).json({ error: "Failed to get access token" });
    }
    res.cookie("token", token, { httpOnly: true });
    res.redirect("/");
  } catch (error) {
    console.error("Error during GitHub OAuth:", error.response?.data || error.message);
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Get User Info
app.get("/me", async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({});
  try {
    const userRes = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${token}` },
    });
    res.json({ login: userRes.data.login });
  } catch (error) {
    console.error("Error fetching user info:", error.response?.data || error.message);
    res.json({});
  }
});

// Handle File Upload
app.post("/upload", async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: "No files were uploaded." });
  }

  const files = req.files.files;
  const repoName = `deployhub-${Date.now()}`;
  const repoPath = path.join(__dirname, repoName);

  try {
    // สร้าง repo ใหม่บน GitHub
    const repoRes = await axios.post(
      "https://api.github.com/user/repos",
      { name: repoName },
      { headers: { Authorization: `token ${token}` } }
    );

    // สร้าง folder ชั่วคราว
    fs.mkdirSync(repoPath, { recursive: true });

    // ย้ายไฟล์ที่อัพโหลดมาไว้ในโฟลเดอร์ชั่วคราว
    if (Array.isArray(files)) {
      for (const file of files) {
        const filePath = path.join(repoPath, file.name);
        await new Promise((resolve, reject) => {
          file.mv(filePath, (err) => (err ? reject(err) : resolve()));
        });
      }
    } else {
      const filePath = path.join(repoPath, files.name);
      await new Promise((resolve, reject) => {
        files.mv(filePath, (err) => (err ? reject(err) : resolve()));
      });
    }

    const git = simpleGit(repoPath);

    await git.init();
    await git.addConfig("user.email", "deployhub@app.com");
    await git.addConfig("user.name", "DeployHub Bot");
    await git.checkoutLocalBranch("main");

    // แก้ตรงนี้ เพิ่ม token ใน URL เพื่อ push ผ่าน HTTPS ได้
    const authUrl = `https://${token}:x-oauth-basic@github.com/${repoRes.data.owner.login}/${repoName}.git`;
    await git.addRemote("origin", authUrl);

    await git.add(".");
    await git.commit("Initial commit");
    await git.push("origin", "main");

    // เปิด GitHub Pages จาก repo นี้
    await axios.post(
      `https://api.github.com/repos/${repoRes.data.owner.login}/${repoName}/pages`,
      { source: { branch: "main", path: "/" } },
      { headers: { Authorization: `token ${token}` } }
    );

    const pagesUrl = `https://${repoRes.data.owner.login}.github.io/${repoName}/`;
    res.json({ url: pagesUrl });
  } catch (error) {
    console.error("Error during file upload:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to upload files" });
  } finally {
    // ลบไฟล์ชั่วคราวทิ้งหลัง 1 วินาที
    setTimeout(() => {
      try {
        fs.rmSync(repoPath, { recursive: true, force: true });
        console.log("Temporary files cleaned up");
      } catch (err) {
        console.error("Error cleaning up temporary files:", err);
      }
    }, 1000);
  }
});

// Logout
app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/");
});

// Start the server
app.listen(PORT, () => {
  console.log(`✅ DeployHub พร้อมใช้งาน: http://localhost:${PORT}`);
  console.log(`✅ Redirect URI: ${REDIRECT_URI}`);
});
