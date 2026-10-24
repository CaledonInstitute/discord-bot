import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  openDb,
  loadSent,
  saveSent,
  parseDuration,
  formatDuration,
  isRelevant,
  buildEmbed,
  CtfEvent,
} from "../src/ctftime.js";

const HOUR = 3600 * 1000;

function makeEvent(overrides: Partial<CtfEvent> = {}): CtfEvent {
  const start = new Date("2026-10-31T20:00:00+00:00");
  return {
    id: 1,
    title: "StealthCup 2026",
    start: start.toISOString(),
    finish: new Date(start.getTime() + 8 * HOUR).toISOString(),
    duration: { days: 0, hours: 8 },
    url: "https://stealth.ait.ac.at/",
    format: "Hack quest",
    organizers: [{ id: 1, name: "0x01DA" }],
    ...overrides,
  };
}

describe("parseDuration", () => {
  it("parses {days, hours} from ctftime API", () => {
    expect(parseDuration(makeEvent({ duration: { days: 1, hours: 12 } }))).toEqual({
      days: 1,
      hours: 12,
    });
  });

  it("handles StealthCup case: 8 hours, 0 days", () => {
    expect(parseDuration(makeEvent())).toEqual({ days: 0, hours: 8 });
  });

  it("falls back to legacy duration_hours", () => {
    const ev = makeEvent() as CtfEvent & { duration_hours: number };
    delete (ev as Partial<CtfEvent>).duration;
    ev.duration_hours = 26;
    expect(parseDuration(ev)).toEqual({ days: 1, hours: 2 });
  });

  it("returns zeros when duration missing", () => {
    expect(parseDuration(makeEvent({ duration: undefined }))).toEqual({ days: 0, hours: 0 });
  });
});

describe("formatDuration", () => {
  it("formats days + hours", () => {
    expect(formatDuration(makeEvent({ duration: { days: 2, hours: 3 } }))).toBe("2 hari 3 jam");
  });

  it("formats hours only", () => {
    expect(formatDuration(makeEvent())).toBe("8 jam");
  });

  it("never returns NaN", () => {
    expect(formatDuration(makeEvent({ duration: undefined }))).not.toMatch(/NaN/);
    expect(formatDuration(makeEvent({ duration: {} }))).toBe("durasi tidak diketahui");
  });
});

describe("isRelevant", () => {
  const now = new Date("2026-10-25T00:00:00Z").getTime();

  it("marks running event", () => {
    const ev = makeEvent({
      start: new Date(now - 2 * HOUR).toISOString(),
      finish: new Date(now + 2 * HOUR).toISOString(),
    });
    expect(isRelevant(ev, now)).toBe("running");
  });

  it("marks upcoming within 7 days", () => {
    const ev = makeEvent({
      start: new Date(now + 3 * 24 * HOUR).toISOString(),
      finish: new Date(now + 3 * 24 * HOUR + 8 * HOUR).toISOString(),
    });
    expect(isRelevant(ev, now)).toBe("upcoming");
  });

  it("ignores event beyond 7 days", () => {
    const ev = makeEvent({
      start: new Date(now + 10 * 24 * HOUR).toISOString(),
      finish: new Date(now + 10 * 24 * HOUR + 8 * HOUR).toISOString(),
    });
    expect(isRelevant(ev, now)).toBeNull();
  });

  it("ignores past event", () => {
    const ev = makeEvent({
      start: new Date(now - 5 * 24 * HOUR).toISOString(),
      finish: new Date(now - 4 * 24 * HOUR).toISOString(),
    });
    expect(isRelevant(ev, now)).toBeNull();
  });

  it("handles invalid dates", () => {
    expect(isRelevant(makeEvent({ start: "garbage" }), now)).toBeNull();
  });
});

describe("buildEmbed (StealthCup regression)", () => {
  it("duration field never contains NaN", () => {
    const embed = buildEmbed(makeEvent(), "upcoming");
    const json = JSON.stringify(embed.toJSON());
    expect(json).not.toMatch(/NaN/);
    expect(json).toContain("8 jam");
    expect(json).toContain("StealthCup 2026");
  });
});

describe("sqlite state", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bot-test-"));
    dbPath = join(dir, "test.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists sent events across reopen", () => {
    const db1 = openDb(dbPath);
    saveSent(db1, 3443, "upcoming", "Sudocrypt v16.0");
    saveSent(db1, 3482, "running", "StealthCup 2026");
    db1.close();

    const db2 = openDb(dbPath);
    const sent = loadSent(db2);
    expect(sent.get(3443)).toBe("upcoming");
    expect(sent.get(3482)).toBe("running");
    db2.close();
  });

  it("upserts phase change", () => {
    const db = openDb(dbPath);
    saveSent(db, 1, "upcoming", "X");
    saveSent(db, 1, "running", "X");
    expect(loadSent(db).get(1)).toBe("running");
    db.close();
  });
});
