import { EmbedBuilder, TextChannel } from "discord.js";
import { readFileSync, writeFileSync, existsSync } from "fs";

const CTFTIME_API = "https://ctftime.org/api/v1/events/?limit=20";
const SENT_DB = "data/ctftime_sent.json";

interface CtfEvent {
  id: number;
  title: string;
  start: string; // ISO
  finish: string;
  duration_hours: number;
  url: string;
  format: string;
  participants?: number;
  organizers: { id: number; name: string }[];
}

interface SentRecord {
  [eventId: string]: string; // eventId -> phase ("running" | "upcoming")
}

function loadSent(): SentRecord {
  try {
    if (existsSync(SENT_DB)) return JSON.parse(readFileSync(SENT_DB, "utf8"));
  } catch {
    /* ignore */
  }
  return {};
}

function saveSent(rec: SentRecord) {
  writeFileSync(SENT_DB, JSON.stringify(rec, null, 2));
}

async function fetchEvents(): Promise<CtfEvent[]> {
  const res = await fetch(CTFTIME_API, { headers: { "User-Agent": "discord-bot-ctftime" } });
  if (!res.ok) throw new Error(`ctftime api ${res.status}`);
  return res.json();
}

export async function checkCtftime(
  channel: TextChannel,
  force = false
): Promise<number> {
  const events = await fetchEvents();
  const sent = loadSent();
  const now = Date.now();
  const batch: EmbedBuilder[] = [];

  for (const ev of events) {
    const start = new Date(ev.start).getTime();
    const end = new Date(ev.finish).getTime();
    const running = now >= start && now < end;
    // CTF berjalan, atau mulai dalam <=7 hari
    if (!running && (start <= now || start > now + 7 * 24 * 3600 * 1000)) continue;

    const phase = running ? "running" : "upcoming";
    if (!force && sent[ev.id] === phase) continue;

    const dur = Math.floor(ev.duration_hours / 24);
    const hrs = ev.duration_hours % 24;
    const embed = new EmbedBuilder()
      .setTitle(`${running ? "🔴" : "🟡"} ${ev.title}`)
      .setURL(ev.url || null)
      .addFields(
        {
          name: "Waktu",
          value: `Mulai: <t:${Math.floor(start / 1000)}:F>\nSelesai: <t:${Math.floor(end / 1000)}:F>`,
        },
        { name: "Durasi", value: dur > 0 ? `${dur} hari ${hrs} jam` : `${hrs} jam`, inline: true },
        { name: "Format", value: ev.format || "unknown", inline: true },
        {
          name: "Organizer",
          value: ev.organizers?.map((o) => o.name).join(", ") || "unknown",
        }
      )
      .setColor(running ? 0xff4444 : 0xffaa00);
    batch.push(embed);
    sent[ev.id] = phase;
  }

  if (batch.length > 0) {
    // kirim per batch max 10 embed
    for (let i = 0; i < batch.length; i += 10) {
      await channel.send({ embeds: batch.slice(i, i + 10) });
    }
    saveSent(sent);
  }
  return batch.length;
}
