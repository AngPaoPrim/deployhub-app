require("dotenv").config();
const express = require("express");
const fileUpload = require("express-fileupload");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");

const app = express();
const PORT = process.env.PORT || 4000;

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

// OAuth Callback
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("No code provided");
  try {
    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, redirect_uri: REDIRECT_URI },
      { headers: { Accept: "application/json" } }
    );
    const token = tokenRes.data.access_token;
    if (!token) return res.status(400).send("Failed to get token");
    res.cookie("token", token, { httpOnly: true });
    res.redirect("/");
  } catch (err) {
    console.error("OAuth error:", err.message);
    res.status(500).send("Authentication failed");
  }
});

// Get current user
app.get("/me", async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({});
  try {
    const user = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${token}` },
    });
    res.json({ login: user.data.login });
  } catch {
    res.json({});
  }
});

// Upload and deploy
app.post("/upload", async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).send("Unauthorized");
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send("No files uploaded");
  }

  const files = req.files.files;
  const repoName = `deployhub-${Date.now()}`;
  const repoPath = path.join(__dirname, repoName);

  try {
    const repoRes = await axios.post(
      "https://api.github.com/user/repos",
      { name: repoName },
      { headers: { Authorization: `token ${token}` } }
    );

    fs.mkdirSync(repoPath, { recursive: true });
    const uploadFile = async (file) => {
      const filePath = path.join(repoPath, file.webkitRelativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      return new Promise((resolve, reject) => {
        file.mv(filePath, (err) => (err ? reject(err) : resolve()));
      });
    };

    if (Array.isArray(files)) {
      await Promise.all(files.map(uploadFile));
    } else {
      await uploadFile(files);
    }

    const git = simpleGit(repoPath);
    await git.init();
    await git.checkoutLocalBranch("main");
    await git.addRemote("origin", repoRes.data.clone_url);
    await git.add(".");
    await git.commit("Initial commit");
    await git.push("origin", "main");

    await axios.post(
      `https://api.github.com/repos/${repoRes.data.owner.login}/${repoName}/pages`,
      { source: { branch: "main", path: "/" } },
      { headers: { Authorization: `token ${token}` } }
    );

    const pagesUrl = `https://${repoRes.data.owner.login}.github.io/${repoName}/`;
    res.json({ url: pagesUrl });
  } catch (err) {
    console.error("Upload error:", err.response?.data || err.message);
    res.status(500).send("Upload failed");
  } finally {
    setTimeout(() => {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }, 1000);
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`✅ Server started: http://localhost:${PORT}`);
});
