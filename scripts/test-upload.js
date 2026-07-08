import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = "http://localhost:5000/api";

const loginRes = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "admin@whiteintegrity.ro",
    password: "admin123",
    companySlug: "white-integrity-fleet",
  }),
});
const { token } = await loginRes.json();

const filePath = path.join(__dirname, "test-glovo.xlsx");
const form = new FormData();
form.append("source", "glovo");
form.append("periodStart", "2026-01-01");
form.append("periodEnd", "2026-01-07");
form.append("file", new Blob([fs.readFileSync(filePath)]), "test-glovo.xlsx");

const uploadRes = await fetch(`${API}/uploads`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});

const text = await uploadRes.text();
console.log("Status:", uploadRes.status);
console.log("Body:", text.slice(0, 800));
