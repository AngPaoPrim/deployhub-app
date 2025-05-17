const express = require("express");
const fileUpload = require("express-fileupload");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// GitHub OAuth Credentials
const CLIENT_ID = "Ov23limMaL5Q5do2eAa3";
const CLIENT_SECRET = "46bb29cbc40c5c0d33d190d2bb2a1788d7b7ffb7";

app.use(cookieParser());
app.use(fileUpload());
app.use(express.static(__dirname));


// GitHub Login
app.get("/login", (req, res) => {
  const redirect_uri = `${req.protocol}://${req.get("host")}/callback`;
  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${redirect_uri}&scope=repo`
  );
});

// GitHub OAuth Callback
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  try {
    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } }
    );
    const token = tokenRes.data.access_token;
    res.cookie("token", token);
    res.redirect("/");
  } catch (error) {
    console.error("Error during GitHub OAuth:", error);
    res.status(500).send("Authentication failed");
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
    console.error("Error fetching user info:", error);
    res.json({});
  }
});

// Handle File Upload
app.post("/upload", async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).send("Unauthorized");

  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  const files = req.files.files; // Uploaded files
  const repoName = `deployhub-${Date.now()}`;
  const repoPath = path.join(__dirname, repoName);

  try {
    // Create a new repository
    const repoRes = await axios.post(
      "https://api.github.com/user/repos",
      { name: repoName },
      { headers: { Authorization: `token ${token}` } }
    );

    // Save files locally
    fs.mkdirSync(repoPath, { recursive: true });
    if (Array.isArray(files)) {
      for (const file of files) {
        const filePath = path.join(repoPath, file.name);
        await new Promise((resolve, reject) => {
          file.mv(filePath, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } else {
      const filePath = path.join(repoPath, files.name);
      await new Promise((resolve, reject) => {
        files.mv(filePath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Push files to GitHub
    const simpleGit = require("simple-git");
    const git = simpleGit(repoPath);

    await git.init();
    console.log("Git repository initialized");

    await git.checkoutLocalBranch("main");
    console.log("Branch 'main' created");

    await git.addRemote("origin", repoRes.data.clone_url);
    console.log("Remote added:", repoRes.data.clone_url);

    await git.add(".");
    console.log("Files added to Git");

    await git.commit("Initial commit");
    console.log("Commit created");

    await git.push("origin", "main");
    console.log("Files pushed to GitHub");

    // Enable GitHub Pages
    await axios.post(
      `https://api.github.com/repos/${repoRes.data.owner.login}/${repoName}/pages`,
      { source: { branch: "main", path: "/" } },
      { headers: { Authorization: `token ${token}` } }
    );

    const pagesUrl = `https://${repoRes.data.owner.login}.github.io/${repoName}/`;
    res.json({ url: pagesUrl });
  } catch (error) {
    console.error("Error during file upload:", error);
    res.status(500).send("Failed to upload files");
  } finally {
    // Clean up local files
    setTimeout(() => {
      try {
        fs.rmSync(repoPath, { recursive: true, force: true });
        console.log("Temporary files cleaned up");
      } catch (err) {
        console.error("Error cleaning up temporary files:", err);
      }
    }, 1000); // Delay cleanup to avoid EBUSY error
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
});