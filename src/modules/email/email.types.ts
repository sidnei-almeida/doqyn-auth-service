export type EmailAddress = {
  name?: string;
  email: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: EmailAddress;
  replyTo?: EmailAddress;
};

export type SmtpTransportConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export interface EmailSender {
  send(message: EmailMessage, transport?: SmtpTransportConfig): Promise<void>;
}
