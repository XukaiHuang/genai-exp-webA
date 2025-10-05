// serverA.js —— Website A (Learning Session Assistant)

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import Tesseract from "tesseract.js";
import fs from "fs";
import "dotenv/config";

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use(cors());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

const BASE_URL = "https://www.chataiapi.com/v1";
const API_KEY = process.env.PROXY_KEY;
const MODEL = "gemini-2.5-flash";

// CSV logger
function logInteraction(site, ip, input, output) {
  const line = `"${new Date().toISOString()}","${site}","${ip.replace(/"/g, "'")}","${input.replace(/"/g, "'")}","${output.replace(/"/g, "'")}"\n`;
  fs.appendFileSync("interaction_logs.csv", line);
}

// List of forbidden Section Two questions
const bannedPhrases = [
  "Multi-Factor Authentication requires users to provide",
  "While on a business trip, you use the company VPN",
  "You are an assistant in the sales department",
  "Zero Trust Architecture is a network security model",
  "You need to approve a file request involving HR data",
  "You are an assistant in the legal department"
];

app.post("/chat", upload.single("image"), async (req, res) => {
  try {
    let userMessage = req.body.text || "";
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

    // OCR recognition if image uploaded
    if (req.file) {
      console.log("Running OCR on uploaded image:", req.file.path);
      const { data: { text: ocrText } } = await Tesseract.recognize(req.file.path, "eng");
      console.log("OCR result:", ocrText);
      if (ocrText && ocrText.trim()) {
        userMessage += `\n\n[Extracted text from image]:\n${ocrText}`;
      }
    }

    // Check if the message includes forbidden content
    if (bannedPhrases.some(p => userMessage.includes(p))) {
      const blockedMsg = "Please complete the questions in Section Two independently.";
      logInteraction("A", ip, userMessage, blockedMsg);
      return res.json({ ok: true, text: blockedMsg });
    }

    // Build Gemini API request
    const payload = {
      model: MODEL,
      messages: [
        { role: "system", content: "You are a helpful assistant for information security learning." },
        { role: "user", content: userMessage }
      ],
      max_output_tokens: 600
    };

    const r = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();
    console.log("API Response:", JSON.stringify(data, null, 2));

    let answer = "";
    if (data.choices?.length > 0) {
      const c = data.choices[0];
      answer = c.message?.content || c.text || (c.message?.parts?.map(p => p.text).join("\n") || "");
    } else if (data.candidates?.length > 0) {
      const parts = data.candidates[0].content?.parts || [];
      answer = parts.map(p => p.text || "").join("\n");
    }
    if (!answer) answer = "[Empty response]";

    logInteraction("A", ip, userMessage, answer);
    res.json({ ok: true, text: answer });

  } catch (e) {
    console.error("Server Error:", e);
    res.status(500).json({ ok: false, error: "proxy_error" });
  }
});

app.listen(process.env.PORT || 8787, () => {
  console.log(`✅ Website A running on http://localhost:${process.env.PORT || 8787}`);
});
