import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import type { announcementFields } from "@/lib/domains/records";
import { today } from "@/lib/operations";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { notify } from "./notify";
import { audit, PeopleError, runAsAdmin, runAsMember } from "./write";

export type Announcement = {
  id: string; title: string; body: string; teamId: string | null; teamName: string | null; publishOn: string; expiresOn: string | null; pinned: boolean; needsAcknowledgement: boolean;
  version: number; author: string; acknowledged: boolean; inAudience: boolean; acknowledgedCount: number; expectedCount: number;
};

// Everyone with access, or the linked accounts of one team.
const audience = `SELECT m.user_id FROM workspace_members m LEFT JOIN employees e ON e.id = m.employee_id
  WHERE m.role <> 'disabled' AND (a.team_id IS NULL OR e.team_id = a.team_id AND e.status <> 'archived')`;
const columns = `a.id, a.title, a.body, a.team_id AS "teamId", t.name AS "teamName", to_char(a.publish_on, 'YYYY-MM-DD') AS "publishOn", to_char(a.expires_on, 'YYYY-MM-DD') AS "expiresOn", a.pinned,
  a.needs_acknowledgement AS "needsAcknowledgement", a.version, u.name AS author, $1 IN (${audience}) AS "inAudience",
  EXISTS (SELECT 1 FROM announcement_acknowledgements k WHERE k.announcement_id = a.id AND k.user_id = $1) AS acknowledged,
  (SELECT count(*)::int FROM announcement_acknowledgements k WHERE k.announcement_id = a.id AND k.user_id IN (${audience})) AS "acknowledgedCount", (SELECT count(*)::int FROM (${audience}) people) AS "expectedCount"`;
const from = `FROM announcements a JOIN "user" u ON u.id = a.created_by LEFT JOIN teams t ON t.id = a.team_id WHERE a.removed_at IS NULL`;
const showing = `a.publish_on <= $2 AND (a.expires_on IS NULL OR a.expires_on >= $2)`;

// Current announcements for this member. Administrators also see the ones addressed to a team they aren’t in.
export async function currentAnnouncements(member: Member, limit = 60) {
  const { rows } = await pool().query<Announcement>(
    `SELECT ${columns} ${from} AND ${showing} AND ($3 = 'admin' OR $1 IN (${audience})) ORDER BY a.pinned DESC, a.publish_on DESC, a.created_at DESC, a.id LIMIT $4`, [member.id, today(), member.role, limit],
  );
  return rows;
}

// For the home page: what is addressed to this member, pinned first.
export async function latestAnnouncements(member: Member, limit = 3) {
  const { rows } = await pool().query<Announcement>(
    `SELECT ${columns} ${from} AND ${showing} AND $1 IN (${audience}) ORDER BY a.pinned DESC, a.publish_on DESC, a.created_at DESC, a.id LIMIT $3`, [member.id, today(), limit],
  );
  return rows;
}

export async function otherAnnouncements() {
  const member = await requireAdmin();
  const { rows } = await pool().query<Announcement>(`SELECT ${columns} ${from} AND NOT (${showing}) ORDER BY a.publish_on DESC, a.created_at DESC, a.id LIMIT 60`, [member.id, today()]);
  const day = today();
  return { scheduled: rows.filter((row) => row.publishOn > day), expired: rows.filter((row) => row.publishOn <= day) };
}

export async function readAnnouncement(id: string) {
  const member = await requireAdmin();
  const { rows } = await pool().query<Announcement>(`SELECT ${columns} ${from} AND a.id = $2`, [member.id, id]);
  return rows[0] ?? null;
}

async function announce(client: PoolClient, actor: Member | null, announcement: { title: string; teamId: string | null; needsAcknowledgement: boolean }) {
  const notice = { title: announcement.title, body: announcement.needsAcknowledgement ? "Please read and acknowledge this announcement." : "New announcement", href: "/workspace/announcements" };
  if (!announcement.teamId) return notify(client, actor, { everyone: true }, notice);
  const { rows } = await client.query<{ id: string }>("SELECT e.id FROM employees e JOIN workspace_members m ON m.employee_id = e.id WHERE e.team_id = $1 AND e.status <> 'archived'", [announcement.teamId]);
  for (const { id } of rows) await notify(client, actor, { employeeId: id }, notice);
}

export function saveAnnouncement(member: Member, input: z.infer<typeof announcementFields>) {
  return runAsAdmin(member, async (client) => {
    const day = today();
    if (input.teamId) {
      const { rowCount } = await client.query("SELECT 1 FROM teams WHERE id = $1 AND archived_at IS NULL", [input.teamId]);
      if (!rowCount) throw new PeopleError("Choose a current team.");
    }
    if (input.expiresOn && input.expiresOn < day) throw new PeopleError("The last day has already passed.");
    const live = input.publishOn <= day;
    const values = [input.title, input.body, input.teamId, input.publishOn, input.expiresOn, input.pinned, input.needsAcknowledgement];
    let notified = false;
    if (input.id) {
      const { rows } = await client.query<{ title: string; body: string; teamId: string | null; notified: boolean; acknowledged: boolean }>(
        `SELECT title, body, team_id AS "teamId", notified_at IS NOT NULL AS notified, EXISTS (SELECT 1 FROM announcement_acknowledgements k WHERE k.announcement_id = id) AS acknowledged
         FROM announcements WHERE id = $1 AND version = $2 AND removed_at IS NULL`, [input.id, input.version],
      );
      if (!rows[0]) throw new PeopleError("This announcement changed while you were editing. Reload it and try again.");
      if (rows[0].acknowledged && (rows[0].title !== input.title || rows[0].body !== input.body)) throw new PeopleError("People have already acknowledged this text. Remove it and publish a new announcement instead.");
      notified = rows[0].notified && rows[0].teamId === input.teamId;
      await client.query(
        `UPDATE announcements SET title = $2, body = $3, team_id = $4, publish_on = $5, expires_on = $6, pinned = $7, needs_acknowledgement = $8, version = version + 1,
         notified_at = CASE WHEN $9 THEN coalesce(notified_at, now()) END WHERE id = $1`, [input.id, ...values, live],
      );
    } else await client.query(
      `INSERT INTO announcements (title, body, team_id, publish_on, expires_on, pinned, needs_acknowledgement, created_by, notified_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN now() END)`, [...values, member.id, live],
    );
    await audit(client, member, input.id ? "announcement.updated" : "announcement.published", { teamId: input.teamId ?? undefined, detail: input.title });
    if (live && !notified) await announce(client, member, input);
  });
}

export function removeAnnouncement(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ title: string }>("UPDATE announcements SET removed_at = now(), version = version + 1 WHERE id = $1 AND removed_at IS NULL RETURNING title", [id]);
    if (!rows[0]) throw new PeopleError("This announcement was already removed.");
    await audit(client, member, "announcement.removed", { detail: rows[0].title });
  });
}

export function acknowledgeAnnouncement(member: Member, id: string) {
  return runAsMember(member, async (client) => {
    const { rows } = await client.query<{ title: string }>(`SELECT a.title FROM announcements a WHERE a.id = $3 AND a.removed_at IS NULL AND a.needs_acknowledgement AND ${showing} AND $1 IN (${audience})`, [member.id, today(), id]);
    if (!rows[0]) throw new PeopleError("This announcement no longer needs your acknowledgement.");
    const { rowCount } = await client.query("INSERT INTO announcement_acknowledgements (announcement_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, member.id]);
    if (rowCount) await audit(client, member, "announcement.acknowledged", { detail: rows[0].title });
  });
}

export async function notifyScheduled(client: PoolClient, day = today()) {
  const { rows } = await client.query<{ title: string; teamId: string | null; needsAcknowledgement: boolean }>(
    `UPDATE announcements SET notified_at = now() WHERE notified_at IS NULL AND removed_at IS NULL AND publish_on <= $1 AND (expires_on IS NULL OR expires_on >= $1)
     RETURNING title, team_id AS "teamId", needs_acknowledgement AS "needsAcknowledgement"`, [day],
  );
  for (const announcement of rows) await announce(client, null, announcement);
}
