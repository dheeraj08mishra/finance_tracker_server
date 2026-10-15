import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sesClient } from "./sesClient.js";

export const sendRecurringTransactionEmail = async (
  toAddress,
  txnDetails,
  isReminder = false
) => {
  // Notes are user input: escape before putting them into HTML
  const escapeHtml = (s) =>
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
  const { amount, category, date } = txnDetails;
  const note = escapeHtml(txnDetails.note);
  const rawNote = txnDetails.note ?? "";
  const formattedDate = new Date(date).toLocaleDateString();

  const subject = isReminder
    ? "Reminder: A Recurring Transaction Will Be Added Tomorrow"
    : "📩 BudgetWise: A Recurring Transaction Was Added";

  const htmlBody = isReminder
    ? `<h2>Reminder: A Recurring Transaction is Scheduled for Tomorrow</h2>
       <p><strong>Amount:</strong> ₹${amount}</p>
       <p><strong>Category:</strong> ${category}</p>
       <p><strong>Note:</strong> ${note}</p>
       <p><strong>Date:</strong> ${formattedDate}</p>
       <hr/>
       <p>— BudgetWise</p>`
    : `<h2>📌 New Recurring Transaction Added</h2>
       <p><strong>Amount:</strong> ₹${amount}</p>
       <p><strong>Category:</strong> ${category}</p>
       <p><strong>Note:</strong> ${note}</p>
       <p><strong>Date:</strong> ${formattedDate}</p>
       <hr/>
       <p>— BudgetWise</p>`;

  const textBody = isReminder
    ? `Reminder: A recurring transaction is scheduled for tomorrow.
Amount: ₹${amount}
Category: ${category}
Note: ${rawNote}
Date: ${formattedDate}

— BudgetWise`
    : `New Recurring Transaction Added 
Amount: ₹${amount}
Category: ${category}
Note: ${rawNote}
Date: ${formattedDate}

— BudgetWise`;

  const command = new SendEmailCommand({
    Destination: { ToAddresses: [toAddress] },
    Message: {
      Subject: { Charset: "UTF-8", Data: subject },
      Body: {
        Html: { Charset: "UTF-8", Data: htmlBody },
        Text: { Charset: "UTF-8", Data: textBody },
      },
    },
    Source: process.env.FROM_EMAIL,
  });

  try {
    const result = await sesClient.send(command);
    console.log("Email sent:", result.MessageId);
    return result;
  } catch (err) {
    console.error("Failed to send email:", err);
    throw err;
  }
};

// Forgot-password email with a single-use link (expires in 30 minutes)
export const sendPasswordResetEmail = async (toAddress, firstName, link) => {
  const name = String(firstName || "there").replace(/[^\p{L} ]/gu, "");
  const command = new SendEmailCommand({
    Destination: { ToAddresses: [toAddress] },
    Message: {
      Subject: { Charset: "UTF-8", Data: "Reset your BudgetWise password" },
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: `<p>Hi ${name},</p>
<p>Someone (hopefully you) asked to reset your BudgetWise password.</p>
<p><a href="${link}">Choose a new password</a></p>
<p>This link works once and expires in 30 minutes. If you didn't ask for it, ignore this email: your password stays the same.</p>
<p>— BudgetWise</p>`,
        },
        Text: {
          Charset: "UTF-8",
          Data: `Hi ${name},

Someone (hopefully you) asked to reset your BudgetWise password.
Choose a new password: ${link}

This link works once and expires in 30 minutes. If you didn't ask for it, ignore this email: your password stays the same.

— BudgetWise`,
        },
      },
    },
    Source: process.env.FROM_EMAIL,
  });
  return sesClient.send(command);
};
