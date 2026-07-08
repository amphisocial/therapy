#!/usr/bin/env python3
from pathlib import Path

ROOT = Path.cwd()
server_path = ROOT / "server.js"
schema_path = ROOT / "db" / "schema.sql"

if not server_path.exists() or not schema_path.exists():
    raise SystemExit("Run this from the TherapyAgent repo root, where server.js and db/schema.sql exist.")

s = server_path.read_text()

old = """const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "";
const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN || "";
const S3_BUCKET = process.env.S3_BUCKET || "";"""

new = """const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "";
const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN || "";
const AWS_EC2_METADATA_DISABLED = String(process.env.AWS_EC2_METADATA_DISABLED || "false").toLowerCase() === "true";
const AWS_EC2_METADATA_BASE_URL = process.env.AWS_EC2_METADATA_BASE_URL || "http://169.254.169.254";
const S3_BUCKET = process.env.S3_BUCKET || "";"""

if old not in s and "const AWS_EC2_METADATA_DISABLED" not in s:
    raise SystemExit("Could not find AWS env constants block in server.js.")
if old in s:
    s = s.replace(old, new)

old = """function s3Configured() {
  return Boolean(S3_BUCKET && S3_REGION && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);
}

function signedS3Options(method, key, body = Buffer.alloc(0), extraHeaders = {}) {
  if (!s3Configured()) {
    throw Object.assign(new Error("S3 is not fully configured. Set S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in .env."), { status: 400 });
  }
  const url = s3UrlForKey(S3_BUCKET, key);
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  const payloadHash = hashHex(payload);
  const { amzDate, dateStamp } = amzDates();
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extraHeaders
  };
  if (AWS_SESSION_TOKEN) headers["x-amz-security-token"] = AWS_SESSION_TOKEN;

  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers)) normalizedHeaders[k.toLowerCase()] = String(v).trim();
  const signedHeaderNames = Object.keys(normalizedHeaders).sort();
  const canonicalHeaders = signedHeaderNames.map(k => `${k}:${normalizedHeaders[k]}\\n`).join("");
  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaderNames.join(";"), payloadHash].join("\\n");
  const credentialScope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hashHex(Buffer.from(canonicalRequest))].join("\\n");
  const signature = hmac(signingKey(AWS_SECRET_ACCESS_KEY, dateStamp, S3_REGION, "s3"), stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
  const finalHeaders = { ...headers, Authorization: authorization, "Content-Length": String(payload.length) };
  return { url, headers: finalHeaders, body: payload };
}"""

new = """let awsCredentialCache = null;

function envAwsCredentials() {
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) return null;
  return {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    sessionToken: AWS_SESSION_TOKEN || "",
    expiration: Number.MAX_SAFE_INTEGER,
    source: "env"
  };
}

function httpText(url, { method = "GET", headers = {}, body = "", timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === "https:" ? https : http;
    const req = client.request(u, { method, headers, timeout: timeoutMs }, res => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(text);
        reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    if (body) req.write(body);
    req.end();
  });
}

async function getImdsToken() {
  try {
    return (await httpText(`${AWS_EC2_METADATA_BASE_URL}/latest/api/token`, {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" },
      timeoutMs: 1200
    })).trim();
  } catch {
    return "";
  }
}

async function fetchEc2RoleCredentials() {
  if (AWS_EC2_METADATA_DISABLED) {
    throw new Error("EC2 metadata credentials are disabled. Set AWS_EC2_METADATA_DISABLED=false or provide AWS access keys.");
  }

  const token = await getImdsToken();
  const headers = token ? { "X-aws-ec2-metadata-token": token } : {};

  const roleName = (await httpText(`${AWS_EC2_METADATA_BASE_URL}/latest/meta-data/iam/security-credentials/`, {
    headers,
    timeoutMs: 1500
  })).trim().split(/\\r?\\n/)[0];

  if (!roleName) throw new Error("No IAM role is attached to this EC2 instance.");

  const raw = await httpText(`${AWS_EC2_METADATA_BASE_URL}/latest/meta-data/iam/security-credentials/${encodeURIComponent(roleName)}`, {
    headers,
    timeoutMs: 1500
  });

  const data = JSON.parse(raw);
  if (data.Code && data.Code !== "Success") throw new Error(`EC2 IAM role credential error: ${data.Code}`);
  if (!data.AccessKeyId || !data.SecretAccessKey) throw new Error("EC2 IAM role credentials were not returned by instance metadata.");

  return {
    accessKeyId: data.AccessKeyId,
    secretAccessKey: data.SecretAccessKey,
    sessionToken: data.Token || "",
    expiration: data.Expiration ? new Date(data.Expiration).getTime() : Date.now() + 30 * 60 * 1000,
    source: `ec2-iam-role:${roleName}`
  };
}

async function getAwsCredentials() {
  const envCreds = envAwsCredentials();
  if (envCreds) return envCreds;

  if (awsCredentialCache && awsCredentialCache.expiration > Date.now() + 5 * 60 * 1000) {
    return awsCredentialCache;
  }

  awsCredentialCache = await fetchEc2RoleCredentials();
  return awsCredentialCache;
}

function s3CredentialSource() {
  if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) return "env";
  if (!AWS_EC2_METADATA_DISABLED) return "ec2-iam-role";
  return "";
}

function s3Configured() {
  return Boolean(S3_BUCKET && S3_REGION && ((AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) || !AWS_EC2_METADATA_DISABLED));
}

async function signedS3Options(method, key, body = Buffer.alloc(0), extraHeaders = {}) {
  if (!S3_BUCKET || !S3_REGION) {
    throw Object.assign(new Error("S3 is not configured. Set S3_BUCKET and S3_REGION in .env."), { status: 400 });
  }

  const credentials = await getAwsCredentials();
  const url = s3UrlForKey(S3_BUCKET, key);
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  const payloadHash = hashHex(payload);
  const { amzDate, dateStamp } = amzDates();
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extraHeaders
  };
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;

  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers)) normalizedHeaders[k.toLowerCase()] = String(v).trim();
  const signedHeaderNames = Object.keys(normalizedHeaders).sort();
  const canonicalHeaders = signedHeaderNames.map(k => `${k}:${normalizedHeaders[k]}\\n`).join("");
  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaderNames.join(";"), payloadHash].join("\\n");
  const credentialScope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hashHex(Buffer.from(canonicalRequest))].join("\\n");
  const signature = hmac(signingKey(credentials.secretAccessKey, dateStamp, S3_REGION, "s3"), stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
  const finalHeaders = { ...headers, Authorization: authorization, "Content-Length": String(payload.length) };
  return { url, headers: finalHeaders, body: payload, credentialSource: credentials.source };
}"""

if old not in s and "async function getAwsCredentials()" not in s:
    raise SystemExit("Could not find s3Configured/signedS3Options block in server.js.")
if old in s:
    s = s.replace(old, new)

s = s.replace(
    'const signed = signedS3Options("PUT", key, body, headers);',
    'const signed = await signedS3Options("PUT", key, body, headers);'
)
s = s.replace(
    'function streamS3Object(key, res, file) {\n  const signed = signedS3Options("GET", key, Buffer.alloc(0), {});',
    'async function streamS3Object(key, res, file) {\n  const signed = await signedS3Options("GET", key, Buffer.alloc(0), {});'
)
s = s.replace(
    '    streamS3Object(file.s3_key, res, file);',
    '    await streamS3Object(file.s3_key, res, file);'
)
s = s.replace(
    '    env_configured: s3Configured(),\n    env_bucket: S3_BUCKET || "",',
    '    env_configured: s3Configured(),\n    credential_source: s3CredentialSource(),\n    env_bucket: S3_BUCKET || "",'
)
s = s.replace(
    '      message: "S3 is not fully configured. Set S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in .env, then restart the app."',
    '      message: "S3 is not configured. Set S3_BUCKET and S3_REGION in .env, and either attach an EC2 IAM role to this instance or provide AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY. Then restart the app."'
)

server_path.write_text(s)

schema = schema_path.read_text()

review_marker = """CREATE TABLE IF NOT EXISTS review_history (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_id UUID REFERENCES users(id),
  reviewer_id UUID REFERENCES users(id),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

review_alters = """CREATE TABLE IF NOT EXISTS review_history (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_id UUID REFERENCES users(id),
  reviewer_id UUID REFERENCES users(id),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Repair older deployments where review_history already existed with fewer columns.
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS from_status TEXT;
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS to_status TEXT;
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id);
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS reviewer_id UUID REFERENCES users(id);
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE review_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
"""

if review_marker in schema and "Repair older deployments where review_history" not in schema:
    schema = schema.replace(review_marker, review_alters)

files_marker = """CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  original_filename TEXT NOT NULL,
  s3_bucket TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  s3_region TEXT,
  s3_version_id TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  kms_key_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
"""

files_alters = """CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  original_filename TEXT NOT NULL,
  s3_bucket TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  s3_region TEXT,
  s3_version_id TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  kms_key_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Repair older deployments where files already existed with fewer columns.
ALTER TABLE files ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE files ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE SET NULL;
ALTER TABLE files ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE files ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE files ADD COLUMN IF NOT EXISTS original_filename TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS s3_bucket TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS s3_key TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS s3_region TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS s3_version_id TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS kms_key_id TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
"""

if files_marker in schema and "Repair older deployments where files" not in schema:
    schema = schema.replace(files_marker, files_alters)

schema_path.write_text(schema)

print("Applied EC2 IAM role S3 support and idempotent schema repair.")
