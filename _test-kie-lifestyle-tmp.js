const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const projectDir = "c:\\Users\\Sagar\\Desktop\\CODES_BGO\\selen-product-studio";
const envContent = fs.readFileSync(path.join(projectDir, ".env.local"), "utf8");
const env = {};
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const NEGATIVE_PROMPT_DELIMITER = /-{2,}\s*NEGATIVE PROMPT\s*-{2,}/i;
function renderTemplate(content, variables) {
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (key in variables ? variables[key] : match));
}

async function getDriveClient() {
  const auth = new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

async function getRingLifestylePrompt(drive) {
  const root = env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const folderRes = await drive.files.list({
    q: `'${root}' in parents and name = 'Templates' and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: "files(id)",
  });
  const folderId = folderRes.data.files?.[0]?.id;
  const fileRes = await drive.files.list({
    q: `'${folderId}' in parents and name = 'ring-lifestyle.txt' and trashed = false`,
    fields: "files(id)",
  });
  const fileId = fileRes.data.files?.[0]?.id;
  const contentRes = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const content = Buffer.from(contentRes.data).toString("utf-8");

  const [positiveRaw, negativeRaw] = content.split(NEGATIVE_PROMPT_DELIMITER);
  const vars = {
    productType: "Ring",
    finish: "polished gold",
    stone: "diamond",
    dimensions: "size 7, 2mm band",
    collections: "Bestsellers",
    referenceNote:
      'Use the uploaded reference photos as the exact product reference — keep the design, proportions, gemstones, and finish unchanged.',
  };
  const prompt = renderTemplate(positiveRaw.trim(), vars);
  const negativePrompt = negativeRaw?.trim() ? renderTemplate(negativeRaw.trim(), vars) : undefined;
  return negativePrompt ? `${prompt}\n\navoid: "${negativePrompt}"` : prompt;
}

async function getRealReferencePhoto(drive) {
  const res = await drive.files.list({
    q: `name = 'front.jpg' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  const file = res.data.files?.[0];
  const contentRes = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(contentRes.data);
}

async function uploadToKie(buffer) {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(buffer)], { type: "image/jpeg" }), "reference.jpg");
  form.append("uploadPath", "selen-product-studio/references");
  const res = await fetch("https://kieai.redpandaai.co/api/file-stream-upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.KIE_API_KEY}` },
    body: form,
  });
  const body = await res.json();
  if (body.code !== 200) throw new Error("Upload failed: " + body.msg);
  return body.data.downloadUrl;
}

async function createTask(prompt, inputUrls) {
  const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.KIE_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2-image-to-image",
      input: { prompt, aspect_ratio: "1:1", resolution: "1K", input_urls: inputUrls },
    }),
  });
  const body = await res.json();
  console.log("createTask response:", JSON.stringify(body));
  if (body.code !== 200) throw new Error("createTask failed: " + body.msg);
  return body.data.taskId;
}

async function pollTask(taskId) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${env.KIE_API_KEY}`, Accept: "application/json" },
    });
    const body = await res.json();
    const record = body.data;
    console.log("poll state:", record.state);
    if (record.state === "success") return JSON.parse(record.resultJson).resultUrls;
    if (record.state === "fail") throw new Error("Task failed: " + record.failMsg);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Timed out.");
}

async function main() {
  const drive = await getDriveClient();

  console.log("Building ring-lifestyle.txt prompt from Drive template...");
  const prompt = await getRingLifestylePrompt(drive);
  console.log("Prompt length:", prompt.length, "chars");

  console.log("\nDownloading reference photo...");
  const buffer = await getRealReferencePhoto(drive);

  console.log("Uploading to Kie...");
  const url = await uploadToKie(buffer);
  console.log("Reference URL:", url);

  console.log("\nCreating lifestyle image-to-image task...");
  const taskId = await createTask(prompt, [url]);
  console.log("taskId:", taskId);

  console.log("\nPolling...");
  const resultUrls = await pollTask(taskId);
  console.log("\nResult URLs:", resultUrls);

  const imgRes = await fetch(resultUrls[0]);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  fs.writeFileSync(path.join(projectDir, "_kie-test-images", "lifestyle-result.jpg"), imgBuffer);
  console.log("Saved lifestyle-result.jpg,", imgBuffer.length, "bytes");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
