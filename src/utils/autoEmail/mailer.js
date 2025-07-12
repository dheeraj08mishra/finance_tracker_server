import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sesClient } from "./sesClient.js";

export const sendRecurringTransactionEmail = async (
  toAddress,
  txnDetails,
  isReminder = false
) => {
  const { amount, category, note, date } = txnDetails;
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
Note: ${note}
Date: ${formattedDate}

— BudgetWise`
    : `New Recurring Transaction Added 
Amount: ₹${amount}
Category: ${category}
Note: ${note}
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
