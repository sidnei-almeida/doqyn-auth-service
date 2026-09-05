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

/** O SMTP da plataforma. Não há mais SMTP por tenant — tudo sai pela DOQYN. */
export type SmtpTransportConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
