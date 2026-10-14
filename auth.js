const crypto = require("crypto");
const db = require("./db");
const mailer = require("./mailer");
const { ObjectId } = require("mongodb");

const SECRET = process.env.AUTH_SECRET || "development-secret-change-me";
const TTL = 60 * 60 * 24 * 7;
const VERIFY_TTL = 60 * 60 * 24;

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: crypto.scryptSync(String(password), salt, 64).toString("hex")
  };
}

function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex")
  );
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

function bearer(req) {
  return req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
}

function createVerifyToken(user) {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    sub: user.id || user._id,
    email: user.email,
    purpose: "verify",
    iat: now,
    exp: now + VERIFY_TTL
  });
}

async function register({ name, email, password }) {
  if (!db.isEnabled()) {
    throw new Error("MongoDB is required for registration.");
  }

  const e = String(email || "").trim().toLowerCase();
  const n = String(name || "").trim().slice(0, 80);

  if (!n) throw new Error("Enter your name.");
  if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error("Enter a valid email.");
  if (String(password || "").length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const users = db.getDatabase().collection("users");

  if (await users.findOne({ email: e })) {
    throw new Error("An account with this email already exists.");
  }

  const credentials = hashPassword(password);
  const now = new Date();

  const result = await users.insertOne({
    name: n,
    email: e,
    ...credentials,
    verified: false,
    createdAt: now,
    usage: { day: "", count: 0 }
  });

  const user = {
    id: String(result.insertedId),
    name: n,
    email: e
  };

  const token = createVerifyToken(user);

  let mailResult = { sent: false, reason: "SMTP not configured" };

  try {
    mailResult = await mailer.sendVerificationEmail({
      to: e,
      name: n,
      token
    });

    if (mailResult.sent) {
      console.log(`📧 Verification email sent to ${e}: ${mailResult.messageId}`);
    } else {
      console.warn(`⚠️ Email not sent to ${e}: ${mailResult.reason}`);
    }
  } catch (error) {
    console.error(`❌ Email sending failed for ${e}:`, error.message);
    mailResult = { sent: false, reason: error.message };
  }

  return {
    ...user,
    emailSent: mailResult.sent
  };
}

async function verifyEmail({ token }) {
  if (!token || typeof token !== "string") {
    throw new Error("Verification token is required.");
  }

  const payload = verify(token);

  if (!payload || payload.purpose !== "verify") {
    throw new Error("Invalid or expired verification link.");
  }

  if (!db.isEnabled()) {
    throw new Error("MongoDB is required for verification.");
  }

  if (!ObjectId.isValid(payload.sub)) {
    throw new Error("Invalid verification token.");
  }

  const users = db.getDatabase().collection("users");
  const id = new ObjectId(payload.sub);

  const user = await users.findOne({ _id: id });

  if (!user) {
    throw new Error("User not found.");
  }

  if (!user.verified) {
    await users.updateOne(
      { _id: id },
      { $set: { verified: true, verifiedAt: new Date() } }
    );
  }

  return {
    id: String(user._id),
    name: user.name || "",
    email: user.email
  };
}

async function login({ email, password }) {
  if (!db.isEnabled()) {
    throw new Error("MongoDB is required for login.");
  }

  const e = String(email || "").trim().toLowerCase();
  const users = db.getDatabase().collection("users");
  const user = await users.findOne({ email: e });

  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    throw new Error("Invalid email or password.");
  }

  if (user.verified === false) {
    throw new Error("Please verify your email before signing in.");
  }

  return {
    id: String(user._id),
    name: user.name || "",
    email: user.email
  };
}

function createSession(user) {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    sub: user.id,
    name: user.name,
    email: user.email,
    iat: now,
    exp: now + TTL
  });
}

async function getUserFromRequest(req) {
  const token = bearer(req);
  const payload = verify(token);
  if (!payload || !db.isEnabled()) return null;
  if (!ObjectId.isValid(payload.sub)) return null;
  const user = await db.getDatabase()
    .collection("users")
    .findOne(
      { _id: new ObjectId(payload.sub) },
      { projection: { hash: 0, salt: 0 } }
    );
  return user ? { ...user, id: String(user._id) } : null;
}

async function consumeUsage(userId) {
  if (!db.isEnabled()) {
    return { allowed: true, remaining: null };
  }
  const limit = Number(process.env.DAILY_MESSAGE_LIMIT || 100);
  const today = new Date().toISOString().slice(0, 10);
  const users = db.getDatabase().collection("users");
  const id = new ObjectId(userId);
  const user = await users.findOne(
    { _id: id },
    { projection: { usage: 1 } }
  );
  const count = user?.usage?.day === today ? Number(user.usage.count || 0) : 0;
  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }
  await users.updateOne(
    { _id: id },
    { $set: { usage: { day: today, count: count + 1 } } }
  );
  return { allowed: true, remaining: limit - count - 1 };
}

module.exports = {
  register,
  login,
  verifyEmail,
  createSession,
  createVerifyToken,
  verify,
  bearer,
  getUserFromRequest,
  consumeUsage
};