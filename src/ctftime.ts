import { EmbedBuilder, TextChannel } from "discord.js";
import Database from "better-sqlite3";

const CTFTIME_API = "https://ctftime.org/api/v1/events/?limit=20";

export interface CtfEvent {
  id: number;
  title: string;
  start: string; // ISO
  finish: string;
  duration?: { hours?: number; days?: number };
  url?: string;
  format?: string;
  participants?: number;
  weight?: number;
  logo?: string;
  ctftime_url?: string;
  live_feed?: string;
  organizers: { id: number; name: string }[];
}

// ---- DB helpers ----

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_events (
      event_id INTEGER PRIMARY KEY,
      phase TEXT NOT NULL CHECK (phase IN ('running','upcoming')),
      title TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

export type SentMap = Map<number, string>;

export function loadSent(db: Database.Database): SentMap {
  const rows = db.prepare("SELECT event_id, phase FROM sent_events").all() as {
    event_id: number;
    phase: string;
  }[];
  return new Map(rows.map((r) => [r.event_id, r.phase]));
}

export function saveSent(db: Database.Database, eventId: number, phase: string, title: string) {
  db.prepare(
    `INSERT INTO sent_events (event_id, phase, title) VALUES (?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET phase = excluded.phase, title = excluded.title, updated_at = datetime('now')`
  ).run(eventId, phase, title);
}

// ---- logic (pure, testable) ----

export function parseDuration(ev: CtfEvent): { days: number; hours: number } {
  // CTFtime API mengirim duration sebagai {days, hours}
  let days = Math.max(0, Math.floor(ev.duration?.days ?? 0));
  let hours = Math.max(0, Math.floor(ev.duration?.hours ?? 0));
  // fallback: kalau ada field legacy duration_hours
  const legacy = (ev as unknown as { duration_hours?: number }).duration_hours;
  if (days === 0 && hours === 0 && typeof legacy === "number" && legacy > 0) {
    days = Math.floor(legacy / 24);
    hours = Math.floor(legacy % 24);
  }
  return { days, hours };
}

export function formatDuration(ev: CtfEvent): string {
  const { days, hours } = parseDuration(ev);
  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam`;
  return "durasi tidak diketahui";
}

export function isRelevant(ev: CtfEvent, now: number, upcomingDays = 7): "running" | "upcoming" | null {
  const start = new Date(ev.start).getTime();
  const end = new Date(ev.finish).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (now >= start && now < end) return "running";
  if (start > now && start <= now + upcomingDays * 24 * 3600 * 1000) return "upcoming";
  return null;
}

export function buildEmbed(ev: CtfEvent, phase: "running" | "upcoming"): EmbedBuilder {
  const start = new Date(ev.start).getTime();
  const end = new Date(ev.finish).getTime();
  const running = phase === "running";

  const links: string[] = [];
  if (ev.url) links.push(`[Website](${ev.url})`);
  if (ev.ctftime_url) links.push(`[CTFtime](${ev.ctftime_url})`);
  if (ev.live_feed) links.push(`[Live Feed](${ev.live_feed})`);

  const embed = new EmbedBuilder()
    .setTitle(`${running ? "🔴" : "🟡"} ${ev.title}`)
    .setURL(ev.url || ev.ctftime_url || null)
    .setThumbnail(ev.logo || null)
    .setColor(running ? 0xff4444 : 0xffaa00)
    .addFields(
      {
        name: "Waktu",
        value: `Mulai: <t:${Math.floor(start / 1000)}:F>\nSelesai: <t:${Math.floor(end / 1000)}:F>`,
      },
      { name: "Durasi", value: formatDuration(ev), inline: true },
      { name: "Format", value: ev.format || "unknown", inline: true },
      { name: "Bobot", value: ev.weight != null ? String(ev.weight) : "unknown", inline: true },
      {
        name: "Tim Terdaftar",
        value: ev.participants != null ? `${ev.participants} tim` : "unknown",
        inline: true,
      },
      { name: "Organizer", value: ev.organizers?.map((o) => o.name).join(", ") || "unknown" }
    );
  if (links.length > 0) {
    embed.addFields({ name: "Link", value: links.join(" • ") });
  }
  return embed;
}

// ---- main check ----

async function fetchEvents(): Promise<CtfEvent[]> {
  const res = await fetch(CTFTIME_API, { headers: { "User-Agent": "discord-bot-ctftime" } });
  if (!res.ok) throw new Error(`ctftime api ${res.status}`);
  return res.json();
}

export async function checkCtftime(
  channel: Pick<TextChannel, "send">,
  db: Database.Database,
  force = false
): Promise<number> {
  const events = await fetchEvents();
  const sent = loadSent(db);
  const now = Date.now();
  const batch: EmbedBuilder[] = [];
  const newSent: { ev: CtfEvent; phase: "running" | "upcoming" }[] = [];

  for (const ev of events) {
    const phase = isRelevant(ev, now);
    if (!phase) continue;
    if (!force && sent.get(ev.id) === phase) continue;

    batch.push(buildEmbed(ev, phase));
    sent.set(ev.id, phase);
    newSent.push({ ev, phase });
  }

  if (batch.length > 0) {
    // kirim per batch max 10 embed
    for (let i = 0; i < batch.length; i += 10) {
      await channel.send({ embeds: batch.slice(i, i + 10) });
    }
    const persist = db.transaction(
      (rows: { ev: CtfEvent; phase: "running" | "upcoming" }[]) => {
        for (const { ev, phase } of rows) saveSent(db, ev.id, phase, ev.title);
      }
    );
    persist(newSent);
  }
  return batch.length;
}
