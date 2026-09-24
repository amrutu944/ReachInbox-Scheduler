import nodemailer, { Transporter } from "nodemailer";
import { env, EtherealSenderConfig } from "../config/env";

const transporters = new Map<string, Transporter>();

function getTransporter(sender: EtherealSenderConfig): Transporter {
  if (!transporters.has(sender.name)) {
    transporters.set(
      sender.name,
      nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user: sender.user, pass: sender.pass },
      })
    );
  }
  return transporters.get(sender.name)!;
}

export function listSenders(): EtherealSenderConfig[] {
  return env.etherealSenders;
}

/** Simple round-robin sender picker so load spreads across all configured Ethereal accounts. */
let rrIndex = 0;
export function pickSender(): EtherealSenderConfig {
  const senders = listSenders();
  if (senders.length === 0) {
    throw new Error("No ETHEREAL_SENDERS configured - see backend/.env.example");
  }
  const sender = senders[rrIndex % senders.length];
  rrIndex++;
  return sender;
}

export async function sendEmailViaEthereal(params: {
  sender: EtherealSenderConfig;
  to: string;
  subject: string;
  html: string;
}): Promise<{ messageId: string; previewUrl: string | false }> {
  const transporter = getTransporter(params.sender);
  const info = await transporter.sendMail({
    from: `"ReachInbox Demo" <${params.sender.user}>`,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  };
}
