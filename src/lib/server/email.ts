import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { connect as connectTcp, isIP, type Socket } from "node:net";
import { hostname } from "node:os";
import { connect as connectTls, type TLSSocket } from "node:tls";
import type { PoolClient } from "pg";
import type { EmailPreference } from "@/lib/domains/platform";
import { keyedHash, seal, unseal } from "./crypto";
import { pool, transaction } from "./db";
import type { Member } from "./member";
import { emailConfigured, passwordAllowed, readPolicy, ssoLabel, workspaceName, workspaceOrigin } from "./platform-settings";
import { audit, PeopleError, runAsAdmin } from "./write";

type Mail = { to: string; subject: string; text: string };
type Transport = { host: string; port: number; implicitTls: boolean; startTls: boolean; user: string; password: string };
export class MailError extends Error {}

const addressPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,250}[A-Za-z0-9])?$/;
const loopback = (host: string) => ["localhost", "127.0.0.1", "::1"].includes(host);

// smtps:// uses TLS from the first byte. smtp:// upgrades with STARTTLS and refuses to continue without it, except to this machine or with ?starttls=off.
export function parseTransport(value: string): Transport {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MailError("OPENWARP_SMTP_URL isn’t a valid URL.");
  }
  if (!["smtp:", "smtps:"].includes(url.protocol) || !url.hostname) throw new MailError("OPENWARP_SMTP_URL must start with smtp:// or smtps://.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const implicitTls = url.protocol === "smtps:";
  const startTls = !implicitTls && !loopback(host) && url.searchParams.get("starttls") !== "off";
  const transport = { host, port: Number(url.port) || (implicitTls ? 465 : 587), implicitTls, startTls, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  if (transport.user && !implicitTls && !startTls && !loopback(host)) throw new MailError("OPENWARP_SMTP_URL can’t send a password without TLS.");
  return transport;
}

export function parseSender(value: string) {
  const match = /^\s*(?:"?([^"<>]*?)"?\s*<([^<>]+)>|([^<>\s]+))\s*$/.exec(value);
  const address = match?.[2] ?? match?.[3] ?? "";
  if (!addressPattern.test(address)) throw new MailError("OPENWARP_EMAIL_FROM must be an address such as OpenWarp <people@example.com>.");
  return { address, name: (match?.[1] ?? "").trim() };
}

// Control characters become spaces, so a value can never start a new header. Other text outside ASCII is encoded in short words.
export function headerText(value: string) {
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
  if (/^[\x20-\x7e]*$/.test(clean) && clean.length < 900 && !clean.includes("=?")) return clean;
  const words: string[] = [];
  let word = "";
  for (const character of clean) {
    if (Buffer.byteLength(word + character) > 45) { words.push(word); word = ""; }
    word += character;
  }
  return [...words, word].map((part) => `=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`).join("\r\n ");
}

export function composeMessage(mail: Mail, from: { address: string; name: string }, date = new Date()) {
  const name = headerText(from.name);
  const body = Buffer.from(mail.text.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${name ? `${/^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "")}"` : name} <${from.address}>` : from.address}`,
    `To: ${mail.to}`, `Subject: ${headerText(mail.subject)}`, `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@${from.address.split("@")[1]}>`,
    "Auto-Submitted: auto-generated", "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", body,
  ].join("\r\n");
}

export function dotStuff(message: string) {
  return message.replace(/\r\n|\r|\n/g, "\r\n").replace(/^\./gm, "..");
}

// One connection, one reply at a time. Anything a server sends before it is asked is a protocol error, which also stops STARTTLS injection.
class SmtpConnection {
  private socket: Socket | TLSSocket;
  private buffer = "";
  private lines: string[] = [];
  private waiting: { resolve: (reply: { code: number; lines: string[] }) => void; reject: (error: Error) => void } | null = null;
  private failure: MailError | null = null;

  constructor(socket: Socket | TLSSocket) {
    this.socket = socket;
    this.attach();
  }

  private attach() {
    this.socket.setTimeout(20_000);
    this.socket.on("data", (chunk: Buffer) => this.receive(chunk.toString("latin1")));
    this.socket.on("timeout", () => this.fail("The mail server didn’t answer in time."));
    this.socket.on("error", (error: NodeJS.ErrnoException) => this.fail(`The mail connection failed (${error.code ?? error.name}).`));
    this.socket.on("close", () => this.fail("The mail server closed the connection."));
  }

  private fail(message: string) {
    this.failure ??= new MailError(message);
    this.waiting?.reject(this.failure);
    this.waiting = null;
    this.socket.destroy();
  }

  private receive(text: string) {
    this.buffer += text;
    if (this.buffer.length > 65_536) return this.fail("The mail server sent too much data.");
    for (let end = this.buffer.indexOf("\n"); end >= 0; end = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, end).replace(/\r$/, "");
      this.buffer = this.buffer.slice(end + 1);
      if (!/^\d{3}([ -]|$)/.test(line) || !this.waiting) return this.fail("The mail server sent an unexpected reply.");
      this.lines.push(line);
      if (line[3] === "-") continue;
      const reply = { code: Number(line.slice(0, 3)), lines: this.lines.splice(0).map((entry) => entry.slice(4)) };
      const { resolve } = this.waiting;
      this.waiting = null;
      resolve(reply);
    }
  }

  async reply(expected: number[], step: string) {
    if (this.failure) throw this.failure;
    const reply = await new Promise<{ code: number; lines: string[] }>((resolve, reject) => { this.waiting = { resolve, reject }; });
    if (!expected.includes(reply.code)) throw new MailError(`The mail server refused ${step} (${reply.code}).`);
    return reply;
  }

  async command(line: string, expected: number[], step: string) {
    if (/[\r\n\0]/.test(line)) throw new MailError("The message has an invalid address.");
    if (this.failure) throw this.failure;
    const reply = this.reply(expected, step);
    this.socket.write(`${line}\r\n`);
    return reply;
  }

  async data(message: string) {
    const reply = this.reply([250], "the message");
    this.socket.write(`${dotStuff(message)}\r\n.\r\n`);
    return reply;
  }

  async upgrade(host: string) {
    if (this.failure || this.buffer || this.lines.length) throw new MailError("The mail server sent data before encryption started.");
    const plain = this.socket;
    plain.removeAllListeners("data").removeAllListeners("timeout").removeAllListeners("error").removeAllListeners("close");
    plain.setTimeout(0);
    this.socket = await secure(() => connectTls({ socket: plain, host, servername: isIP(host) ? undefined : host }));
    this.attach();
  }

  end() {
    this.socket.removeAllListeners("close").on("error", () => undefined);
    this.failure ??= new MailError("The mail connection is closed.");
    this.socket.end("QUIT\r\n");
    setTimeout(() => this.socket.destroy(), 1_000).unref();
  }
}

function secure(open: () => TLSSocket) {
  return new Promise<TLSSocket>((resolve, reject) => {
    const socket = open();
    const timer = setTimeout(() => { socket.destroy(); reject(new MailError("The mail server didn’t finish the TLS handshake.")); }, 15_000);
    socket.once("secureConnect", () => { clearTimeout(timer); socket.removeAllListeners("error"); resolve(socket); });
    socket.once("error", (error: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new MailError(`The TLS connection to the mail server failed (${error.code ?? error.name}).`)); });
  });
}

function plain(host: string, port: number) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connectTcp({ host, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new MailError("The mail server didn’t answer in time.")); }, 15_000);
    socket.once("connect", () => { clearTimeout(timer); socket.removeAllListeners("error"); resolve(socket); });
    socket.once("error", (error: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new MailError(`The mail connection failed (${error.code ?? error.name}).`)); });
  });
}

export async function sendMail(mail: Mail) {
  if (!emailConfigured()) throw new MailError("Email isn’t set up.");
  const transport = parseTransport(process.env.OPENWARP_SMTP_URL!);
  const from = parseSender(process.env.OPENWARP_EMAIL_FROM!);
  if (!addressPattern.test(mail.to)) throw new MailError("The recipient address isn’t valid.");
  const socket = transport.implicitTls
    ? await secure(() => connectTls({ host: transport.host, port: transport.port, servername: isIP(transport.host) ? undefined : transport.host }))
    : await plain(transport.host, transport.port);
  const connection = new SmtpConnection(socket);
  try {
    await connection.reply([220], "the connection");
    const name = /^[A-Za-z0-9.-]{1,200}$/.test(hostname()) ? hostname() : "openwarp";
    let features = (await connection.command(`EHLO ${name}`, [250], "the greeting")).lines;
    if (transport.startTls) {
      if (!features.some((line) => line.toUpperCase() === "STARTTLS")) throw new MailError("The mail server doesn’t offer STARTTLS, so nothing was sent.");
      await connection.command("STARTTLS", [220], "STARTTLS");
      await connection.upgrade(transport.host);
      features = (await connection.command(`EHLO ${name}`, [250], "the greeting")).lines;
    }
    if (transport.user) {
      const mechanisms = features.find((line) => /^AUTH[ =]/i.test(line))?.toUpperCase().split(/[ =]/) ?? [];
      if (mechanisms.includes("PLAIN")) await connection.command(`AUTH PLAIN ${Buffer.from(`\0${transport.user}\0${transport.password}`).toString("base64")}`, [235], "the sign-in");
      else if (mechanisms.includes("LOGIN")) {
        await connection.command("AUTH LOGIN", [334], "the sign-in");
        await connection.command(Buffer.from(transport.user).toString("base64"), [334], "the sign-in");
        await connection.command(Buffer.from(transport.password).toString("base64"), [235], "the sign-in");
      } else throw new MailError("The mail server offers no supported sign-in method.");
    }
    await connection.command(`MAIL FROM:<${from.address}>`, [250], "the sender");
    await connection.command(`RCPT TO:<${mail.to}>`, [250, 251], "the recipient");
    await connection.command("DATA", [354], "the message");
    await connection.data(composeMessage(mail, from));
  } finally {
    connection.end();
  }
}

type Queued = { userId: string; kind: "notification" | "invitation" | "reset" | "changed"; subject: string; text: string };

// Email is queued in the transaction it belongs to and sent by the worker. Without SMTP nothing is queued. Only notifications follow the person’s
// email preference, so a security notice uses kind "changed" and can’t be switched off or marked read before it goes out.
export async function queueEmail(client: Pick<PoolClient, "query">, { userId, kind, subject, text }: Queued) {
  if (!emailConfigured()) return;
  const id = randomUUID();
  const body = `${text}\n\n${workspaceName()}\n${workspaceOrigin()}/workspace\n`;
  await client.query(
    `INSERT INTO email_messages (id, kind, user_id, recipient, subject, body) SELECT $1, $2, u.id, u.email, $4, $5 FROM "user" u JOIN workspace_members m ON m.user_id = u.id WHERE u.id = $3 AND m.role <> 'disabled'`,
    [id, kind, userId, subject.replace(/\s+/g, " ").slice(0, 200), seal(body, `email:${id}`)],
  );
}

export const hashPasswordToken = (token: string) => keyedHash(token, "password-token");

export async function issuePasswordLink(client: PoolClient, userId: string, purpose: "reset" | "invitation") {
  const token = randomBytes(32).toString("base64url");
  const hash = hashPasswordToken(token);
  await client.query("UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL", [userId, purpose]);
  await client.query("INSERT INTO password_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + $4::interval)", [hash, userId, purpose, purpose === "reset" ? "30 minutes" : "7 days"]);
  return { link: `${workspaceOrigin()}${purpose === "reset" ? "/login/reset" : "/join"}?token=${token}`, version: hash.slice(0, 24) };
}

export async function queuePasswordLink(client: PoolClient, userId: string, purpose: "reset" | "invitation") {
  const { link } = await issuePasswordLink(client, userId, purpose);
  await queueEmail(client, purpose === "reset"
    ? { userId, kind: "reset", subject: "Reset your password", text: `Someone asked to reset your password. Open this link within 30 minutes to choose a new one. It works once.\n\n${link}\n\nIf it wasn’t you, ignore this email. Your password hasn’t changed.` }
    : { userId, kind: "invitation", subject: `Your account for ${workspaceName()}`, text: `You have an account for ${workspaceName()}. Open this link within 7 days to choose your password. It works once.\n\n${link}` });
}

export async function queueInvitation(client: PoolClient, userId: string, role: "admin" | "viewer") {
  if (!emailConfigured()) return;
  if (passwordAllowed(await readPolicy(client), role)) return queuePasswordLink(client, userId, "invitation");
  await queueEmail(client, { userId, kind: "invitation", subject: `Your account for ${workspaceName()}`, text: `You have an account for ${workspaceName()}. Sign in with ${ssoLabel()}:\n\n${workspaceOrigin()}/join?signin=sso` });
}

export async function readPreference(member: Member) {
  const { rows } = await pool().query<{ email: EmailPreference }>("SELECT email FROM user_preferences WHERE user_id = $1", [member.id]);
  return rows[0]?.email ?? "all";
}

export async function savePreference(member: Member, email: EmailPreference) {
  await pool().query("INSERT INTO user_preferences (user_id, email) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET email = excluded.email", [member.id, email]);
}

export type EmailStatus = {
  configured: boolean; server: string; from: string; problem: string; queued: number; failed: number;
  recent: { id: string; kind: string; recipient: string; subject: string; state: "queued" | "sent" | "failed"; error: string; at: Date }[];
};

export async function readEmailStatus(member: Member): Promise<EmailStatus> {
  if (member.role !== "admin") throw new PeopleError("Administrator access is required.");
  const configured = emailConfigured();
  let server = "";
  let problem = "";
  if (configured) {
    try {
      const { host, port, implicitTls, startTls } = parseTransport(process.env.OPENWARP_SMTP_URL!);
      server = `${host}:${port}, ${implicitTls ? "TLS" : startTls ? "STARTTLS" : "no encryption"}`;
      parseSender(process.env.OPENWARP_EMAIL_FROM!);
    } catch (error) {
      problem = error instanceof MailError ? error.message : "The email settings are invalid.";
    }
  }
  const [counts, recent] = await Promise.all([
    pool().query<{ queued: number; failed: number }>("SELECT count(*) FILTER (WHERE state = 'queued')::int AS queued, count(*) FILTER (WHERE state = 'failed')::int AS failed FROM email_messages"),
    pool().query<EmailStatus["recent"][number]>("SELECT id, kind, recipient, subject, state, error, coalesce(sent_at, created_at) AS at FROM email_messages ORDER BY created_at DESC, id LIMIT 20"),
  ]);
  return { configured, server, from: configured ? process.env.OPENWARP_EMAIL_FROM!.slice(0, 200) : "", problem, ...counts.rows[0], recent: recent.rows };
}

// The test is sent while the administrator waits, so they see the server’s answer.
export async function sendTestEmail(member: Member) {
  await runAsAdmin(member, (client) => audit(client, member, "email.tested"));
  const id = randomUUID();
  let error = "";
  try {
    await sendMail({ to: member.email, subject: `Test email from ${workspaceName()}`, text: `Email is working for ${workspaceName()}.\n${workspaceOrigin()}/workspace\n` });
  } catch (cause) {
    error = cause instanceof MailError ? cause.message : "The message could not be sent.";
  }
  await pool().query("INSERT INTO email_messages (id, kind, user_id, recipient, subject, state, attempts, error, sent_at) VALUES ($1, 'test', $2, $3, 'Test email', $4, 1, $5, CASE WHEN $4 = 'sent' THEN now() END)", [id, member.id, member.email, error ? "failed" : "sent", error]);
  if (error) throw new PeopleError(error);
}

// Moves new notifications into the email queue. Anything already read, or older than a day when email was turned on, is left alone.
async function queueNotifications() {
  await transaction(async (client) => {
    const { rows } = await client.query<{ id: string; userId: string; title: string; body: string; href: string; send: boolean }>(
      `SELECT n.id::text, n.user_id AS "userId", n.title, n.body, n.href,
       n.read_at IS NULL AND n.created_at > now() - interval '1 day' AND m.role <> 'disabled' AND (coalesce(p.email, 'all') = 'all' OR p.email = 'requests' AND n.kind = 'request') AS send
       FROM notifications n JOIN workspace_members m ON m.user_id = n.user_id LEFT JOIN user_preferences p ON p.user_id = n.user_id
       WHERE n.emailed_at IS NULL ORDER BY n.id LIMIT 200 FOR UPDATE OF n SKIP LOCKED`,
    );
    for (const row of rows) {
      if (row.send) await queueEmail(client, { userId: row.userId, kind: "notification", subject: row.title, text: `${row.title}\n${row.body ? `${row.body}\n` : ""}\n${workspaceOrigin()}${row.href}\n\nChoose which emails you get in My account.` });
    }
    if (rows.length) await client.query("UPDATE notifications SET emailed_at = now() WHERE id = ANY($1::bigint[])", [rows.map((row) => row.id)]);
  });
}

const maxAttempts = 6;

export async function deliverEmail(stopped: () => boolean) {
  if (!emailConfigured()) return;
  await queueNotifications();
  // A claimed message is retried after five minutes if this process dies before it records the result.
  const { rows } = await pool().query<{ id: string; recipient: string; subject: string; body: Buffer; attempts: number }>(
    `UPDATE email_messages SET attempts = attempts + 1, next_attempt_at = now() + interval '5 minutes' WHERE id IN
     (SELECT id FROM email_messages WHERE state = 'queued' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING id, recipient, subject, body, attempts`,
  );
  for (const message of rows) {
    if (stopped()) return;
    let error = "";
    try {
      await sendMail({ to: message.recipient, subject: message.subject, text: unseal(message.body, `email:${message.id}`) });
    } catch (cause) {
      error = cause instanceof MailError ? cause.message : "The message could not be sent.";
    }
    const state = !error ? "sent" : message.attempts >= maxAttempts ? "failed" : "queued";
    await pool().query(
      `UPDATE email_messages SET state = $2, error = $3, body = CASE WHEN $2 = 'queued' THEN body END, sent_at = CASE WHEN $2 = 'sent' THEN now() END,
       next_attempt_at = now() + make_interval(secs => $4) WHERE id = $1`, [message.id, state, error.slice(0, 300), 60 * 4 ** (message.attempts - 1)],
    );
  }
}
