// Grant (or with --revoke, remove) admin rights.
//   npm run make-admin -- someone@example.com
//   npm run make-admin -- someone@example.com --revoke
// Uses MONGODB_URI from .env (or the environment), like the API.
import mongoose from "mongoose";
import dotenv from "dotenv";
import { setRole } from "./src/utils/admin.js";
dotenv.config();

const [email, flag] = process.argv.slice(2);
if (!email || (flag && flag !== "--revoke")) {
  console.error("Usage: npm run make-admin -- <email> [--revoke]");
  process.exit(1);
}
const role = flag === "--revoke" ? "user" : "admin";

await mongoose.connect(process.env.MONGODB_URI);
try {
  const user = await setRole(email, role);
  if (!user) {
    console.error(`No account with the email ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${user.email} is now: ${user.role}`);
  }
} finally {
  await mongoose.disconnect();
}
