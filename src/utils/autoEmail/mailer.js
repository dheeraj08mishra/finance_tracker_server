import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sesClient } from "./sesClient.js";

// "ses" sends through Amazon SES; "log" prints the email instead (local
// development, where AWS keys are switched off). Default: ses in
// production, log everywhere else.
const deliveryMode = () =>
  process.env.EMAIL_DELIVERY ||
  (process.env.NODE_ENV === "production" ? "ses" : "log");

const appUrl = () =>
  (process.env.APP_URL || "http://localhost:1234").replace(/\/$/, "");

// Anything that came from a user goes through this before HTML
export const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
export const money = (n) => inr.format(Number(n) || 0);

const firstName = (user) =>
  String(user?.firstName || "there")
    .replace(/[^\p{L} ]/gu, "")
    .replace(/^\p{L}/u, (c) => c.toUpperCase());

// Shared look for every BudgetWise email
function layout(title, bodyHtml) {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2433">
<div style="background:#4f46e5;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0;font-weight:600">BudgetWise</div>
<div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 12px 12px;padding:24px">
<h2 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h2>
${bodyHtml}
<p style="margin-top:24px;font-size:12px;color:#6b7280">You can change which emails you get in
<a href="${appUrl()}/profile" style="color:#4f46e5">Profile → Notifications</a>.</p>
</div></div>`;
}

export async function deliver({ to, subject, html, text }) {
  if (deliveryMode() === "log") {
    console.log(`[EMAIL] to=${to} subject="${subject}"\n${text}\n[/EMAIL]`);
    return { logged: true };
  }
  return sesClient.send(
    new SendEmailCommand({
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Charset: "UTF-8", Data: subject },
        Body: {
          Html: { Charset: "UTF-8", Data: html },
          Text: { Charset: "UTF-8", Data: text },
        },
      },
      Source: process.env.FROM_EMAIL,
    })
  );
}

// Recurring payment reminder (isReminder) or "added" notice
export const sendRecurringTransactionEmail = async (
  toAddress,
  txnDetails,
  isReminder = false
) => {
  const { amount, category, date } = txnDetails;
  const note = txnDetails.note || "Recurring payment";
  const when = new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const subject = isReminder
    ? `Reminder: ${note} (${money(amount)}) is due tomorrow`
    : `${note} (${money(amount)}) was added`;
  const lines = [
    ["Amount", money(amount)],
    ["Category", category],
    ["Note", note],
    ["Date", when],
  ];
  return deliver({
    to: toAddress,
    subject,
    html: layout(
      isReminder
        ? "A recurring payment is due tomorrow"
        : "A recurring payment was added",
      lines
        .map(
          ([k, v]) =>
            `<p style="margin:4px 0"><strong>${k}:</strong> ${escapeHtml(v)}</p>`
        )
        .join("")
    ),
    text: lines.map(([k, v]) => `${k}: ${v}`).join("\n"),
  });
};

// Forgot-password email with a single-use link (expires in 30 minutes)
export const sendPasswordResetEmail = async (toAddress, name, link) =>
  deliver({
    to: toAddress,
    subject: "Reset your BudgetWise password",
    html: layout(
      "Reset your password",
      `<p>Hi ${escapeHtml(firstName({ firstName: name }))},</p>
<p>Someone (hopefully you) asked to reset your BudgetWise password.</p>
<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Choose a new password</a></p>
<p>This link works once and expires in 30 minutes. If you didn't ask for it, ignore this email: your password stays the same.</p>`
    ),
    text: `Hi ${firstName({ firstName: name })},

Someone (hopefully you) asked to reset your BudgetWise password.
Choose a new password: ${link}

This link works once and expires in 30 minutes. If you didn't ask for it, ignore this email: your password stays the same.`,
  });

const CATEGORY_LABEL = {
  need: "Needs",
  want: "Wants",
  investment: "Investments",
  other: "Other",
};

// A category reached 80% of its monthly budget, or went over
export const sendBudgetAlertEmail = async (user, row, monthLabel) => {
  const label = CATEGORY_LABEL[row.category] || row.category;
  const over = row.level === "over";
  const subject = over
    ? `You're over your ${label} budget for ${monthLabel}`
    : `You've used ${row.percent}% of your ${label} budget`;
  const detail = over
    ? `You've spent ${money(row.spent)} on ${label} in ${monthLabel}, ${money(row.spent - row.limit)} over your ${money(row.limit)} budget.`
    : `You've spent ${money(row.spent)} of your ${money(row.limit)} ${label} budget for ${monthLabel} (${row.percent}%). ${money(row.limit - row.spent)} left.`;
  return deliver({
    to: user.email,
    subject,
    html: layout(
      over
        ? `Over budget: ${label}`
        : `Heads up: ${label} budget at ${row.percent}%`,
      `<p>Hi ${escapeHtml(firstName(user))},</p><p>${escapeHtml(detail)}</p>
<p><a href="${appUrl()}/" style="color:#4f46e5">See your dashboard</a></p>`
    ),
    text: `Hi ${firstName(user)},\n\n${detail}\n\nDashboard: ${appUrl()}/`,
  });
};

// Last month at a glance
export const sendMonthlySummaryEmail = async (user, s) => {
  const change =
    s.previousSpending > 0
      ? Math.round(
          ((s.spending - s.previousSpending) / s.previousSpending) * 100
        )
      : null;
  const changeText =
    change === null
      ? ""
      : change === 0
        ? " (same as the month before)"
        : ` (${Math.abs(change)}% ${change > 0 ? "more" : "less"} than the month before)`;
  const rows = [
    ["Income", money(s.income)],
    ["Spending", money(s.spending) + changeText],
    ["Saved to goals", money(s.saved)],
    ["Left over", money(s.income - s.spending - s.saved)],
  ];
  const top = s.topCategories
    .map(
      (c) => `${CATEGORY_LABEL[c.category] || c.category}: ${money(c.total)}`
    )
    .join(", ");
  const budgets = s.budgets
    .filter((b) => b.limit)
    .map(
      (b) =>
        `${CATEGORY_LABEL[b.category]}: ${b.percent}% of ${money(b.limit)}${b.level === "over" ? " (over)" : ""}`
    );
  const textParts = [
    `Hi ${firstName(user)},`,
    `Here's your ${s.monthLabel} at a glance.`,
    rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
    top && `Where most of it went: ${top}`,
    budgets.length && `Budgets: ${budgets.join("; ")}`,
    `Dashboard: ${appUrl()}/`,
  ].filter(Boolean);
  return deliver({
    to: user.email,
    subject: `Your ${s.monthLabel} summary: ${money(s.spending)} spent, ${money(s.saved)} saved`,
    html: layout(
      `Your ${s.monthLabel} summary`,
      `<p>Hi ${escapeHtml(firstName(user))}, here's your ${escapeHtml(s.monthLabel)} at a glance.</p>
<table style="width:100%;border-collapse:collapse">${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 0;color:#6b7280">${k}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`
        )
        .join("")}</table>
${top ? `<p><strong>Where most of it went:</strong> ${escapeHtml(top)}</p>` : ""}
${budgets.length ? `<p><strong>Budgets:</strong> ${escapeHtml(budgets.join("; "))}</p>` : ""}
<p><a href="${appUrl()}/" style="color:#4f46e5">Open your dashboard</a></p>`
    ),
    text: textParts.join("\n\n"),
  });
};
