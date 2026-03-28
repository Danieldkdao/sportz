import "dotenv/config";
import fs from "fs/promises";

const DELAY_MS = Number.parseInt(process.env.DELAY_MS || "250", 10);
const NEW_MATCH_DELAY_MIN_MS = 2000;
const NEW_MATCH_DELAY_MAX_MS = 3000;
const DEFAULT_MATCH_DURATION_MINUTES = Number.parseInt(
  process.env.SEED_MATCH_DURATION_MINUTES || "120",
  10,
);
const FORCE_LIVE =
  process.env.SEED_FORCE_LIVE !== "0" &&
  process.env.SEED_FORCE_LIVE !== "false";
const API_URL = process.env.API_URL;
if (!API_URL) {
  throw new Error("API_URL is required to seed via REST endpoints.");
}

const DEFAULT_DATA_FILE = new URL("../data/data.json", import.meta.url);

type JsonObject = Record<string, unknown>;

type SeedMatch = {
  id: number;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime?: string;
  endTime?: string;
  homeScore?: number;
  awayScore?: number;
};

type SeedCommentaryEntry = {
  matchId?: number;
  minute?: number;
  sequence?: number;
  period?: string;
  eventType?: string;
  team?: string;
  actor?: string;
  message?: string;
  metadata?: JsonObject;
  tags?: string[];
  scoreDelta?: {
    home?: number;
    away?: number;
  };
  runs?: number;
};

type SeedDataFile =
  | SeedCommentaryEntry[]
  | {
      commentary?: SeedCommentaryEntry[];
      feed?: SeedCommentaryEntry[];
      matches?: SeedMatch[];
    };

type SeedData = {
  feed: SeedCommentaryEntry[];
  matches: SeedMatch[];
};

type ApiMatch = {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  endTime: string;
  homeScore?: number | null;
  awayScore?: number | null;
};

type MatchState = {
  match: ApiMatch;
  score: {
    home: number;
    away: number;
  };
  fakeNext: "home" | "away";
};

type CreatedCommentary = JsonObject & {
  message: string;
};

type CreateCommentaryPayload = {
  message: string;
  minute?: number;
  sequence?: number;
  period?: string;
  eventType?: string;
  actor?: string;
  team?: string;
  metadata?: JsonObject;
  tags?: string[];
};

type ScoreDelta = {
  home: number;
  away: number;
};

async function readJsonFile<T>(fileUrl: URL): Promise<T> {
  const raw = await fs.readFile(fileUrl, "utf8");
  return JSON.parse(raw) as T;
}

async function loadSeedData(): Promise<SeedData> {
  const parsed = await readJsonFile<SeedDataFile>(DEFAULT_DATA_FILE);

  if (Array.isArray(parsed)) {
    return { feed: parsed, matches: [] };
  }

  if (Array.isArray(parsed.commentary)) {
    return { feed: parsed.commentary, matches: parsed.matches ?? [] };
  }

  if (Array.isArray(parsed.feed)) {
    return { feed: parsed.feed, matches: parsed.matches ?? [] };
  }

  throw new Error(
    "Seed data must be an array or contain a commentary/feed array.",
  );
}

async function fetchMatches(limit = 100): Promise<ApiMatch[]> {
  const response = await fetch(`${API_URL}/matches?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch matches: ${response.status}`);
  }
  const payload = (await response.json()) as { data?: ApiMatch[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLiveMatch(match: Pick<ApiMatch, "startTime" | "endTime">): boolean {
  const start = parseDate(match.startTime);
  const end = parseDate(match.endTime);
  if (!start || !end) {
    return false;
  }
  const now = new Date();
  return now >= start && now < end;
}

function buildMatchTimes(seedMatch: SeedMatch) {
  const now = new Date();
  const durationMs = DEFAULT_MATCH_DURATION_MINUTES * 60 * 1000;

  let start = parseDate(seedMatch.startTime);
  let end = parseDate(seedMatch.endTime);

  if (!start && !end) {
    start = new Date(now.getTime() - 5 * 60 * 1000);
    end = new Date(start.getTime() + durationMs);
  } else {
    if (start && !end) {
      end = new Date(start.getTime() + durationMs);
    }
    if (!start && end) {
      start = new Date(end.getTime() - durationMs);
    }
  }

  if (FORCE_LIVE && start && end) {
    if (!(now >= start && now < end)) {
      start = new Date(now.getTime() - 5 * 60 * 1000);
      end = new Date(start.getTime() + durationMs);
    }
  }

  if (!start || !end) {
    throw new Error("Seed match must include valid startTime and endTime.");
  }

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

async function createMatch(seedMatch: SeedMatch): Promise<ApiMatch> {
  const { startTime, endTime } = buildMatchTimes(seedMatch);

  const response = await fetch(`${API_URL}/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sport: seedMatch.sport,
      homeTeam: seedMatch.homeTeam,
      awayTeam: seedMatch.awayTeam,
      startTime,
      endTime,
      homeScore: seedMatch.homeScore ?? 0,
      awayScore: seedMatch.awayScore ?? 0,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create match: ${response.status}`);
  }
  const responsePayload = (await response.json()) as { data: ApiMatch };
  return responsePayload.data;
}

async function insertCommentary(
  matchId: string,
  entry: SeedCommentaryEntry,
): Promise<CreatedCommentary> {
  const payload: CreateCommentaryPayload = {
    message: entry.message ?? "Update",
  };
  if (entry.minute !== undefined && entry.minute !== null) {
    payload.minute = entry.minute;
  }
  if (entry.sequence !== undefined && entry.sequence !== null) {
    payload.sequence = entry.sequence;
  }
  if (entry.period !== undefined && entry.period !== null) {
    payload.period = entry.period;
  }
  if (entry.eventType !== undefined && entry.eventType !== null) {
    payload.eventType = entry.eventType;
  }
  if (entry.actor !== undefined && entry.actor !== null) {
    payload.actor = entry.actor;
  }
  if (entry.team !== undefined && entry.team !== null) {
    payload.team = entry.team;
  }
  if (entry.metadata !== undefined && entry.metadata !== null) {
    payload.metadata = entry.metadata;
  }
  if (entry.tags !== undefined && entry.tags !== null) {
    payload.tags = entry.tags;
  }

  const response = await fetch(`${API_URL}/matches/${matchId}/commentary`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // NOTE: Avoid sending nulls; the API expects missing optional fields.
    // body: JSON.stringify({
    //   minute: entry.minute ?? null,
    //   sequence: entry.sequence ?? null,
    //   period: entry.period ?? null,
    //   eventType: entry.eventType ?? null,
    //   actor: entry.actor ?? null,
    //   team: entry.team ?? null,
    //   message: entry.message ?? "Update",
    //   metadata: entry.metadata ?? null,
    //   tags: entry.tags ?? null,
    // }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to create commentary: ${response.status}`);
  }
  const responsePayload = (await response.json()) as { data: CreatedCommentary };
  return responsePayload.data;
}

function extractRuns(entry: SeedCommentaryEntry): number | null {
  if (Number.isFinite(entry.runs)) {
    return Number(entry.runs);
  }

  if (
    entry.metadata &&
    typeof entry.metadata === "object" &&
    Number.isFinite(entry.metadata.runs)
  ) {
    return Number(entry.metadata.runs);
  }

  if (entry.eventType === "four") {
    return 4;
  }
  if (entry.eventType === "six") {
    return 6;
  }
  if (entry.eventType === "run") {
    return 1;
  }

  return null;
}

function scoreDeltaFromEntry(
  entry: SeedCommentaryEntry,
  match: ApiMatch,
): ScoreDelta | null {
  if (entry.scoreDelta && typeof entry.scoreDelta === "object") {
    return {
      home: Number(entry.scoreDelta.home || 0),
      away: Number(entry.scoreDelta.away || 0),
    };
  }

  if (entry.eventType === "goal") {
    if (entry.team === match.homeTeam) {
      return { home: 1, away: 0 };
    }
    if (entry.team === match.awayTeam) {
      return { home: 0, away: 1 };
    }
  }

  const runs = extractRuns(entry);
  if (runs !== null) {
    if (entry.team === match.homeTeam) {
      return { home: runs, away: 0 };
    }
    if (entry.team === match.awayTeam) {
      return { home: 0, away: runs };
    }
  }

  return null;
}

function inningsRank(period: string | null | undefined): number {
  if (!period) {
    return 0;
  }
  const lower = String(period).toLowerCase();
  const match = lower.match(/(\d+)(st|nd|rd|th)/);
  if (match) {
    return Number(match[1]) || 0;
  }
  if (lower.includes("first")) {
    return 1;
  }
  if (lower.includes("second")) {
    return 2;
  }
  if (lower.includes("third")) {
    return 3;
  }
  if (lower.includes("fourth")) {
    return 4;
  }
  return 0;
}

// function cricketScoreDelta(entry, match) {
//   const battingTeam = cricketBattingTeam(entry, match);
//   let delta = scoreDeltaFromEntry(entry, match);
//   if (!delta) {
//     if (!battingTeam) {
//       return null;
//     }
//     const points = 1;
//     return battingTeam === match.homeTeam
//       ? { home: points, away: 0 }
//       : { home: 0, away: points };
//   }
//
//   if (!battingTeam) {
//     return delta;
//   }
//
//   if (battingTeam === match.homeTeam) {
//     return { home: delta.home, away: 0 };
//   }
//   return { home: 0, away: delta.away };
// }

function normalizeCricketFeed(
  entries: SeedCommentaryEntry[],
  match: ApiMatch,
): SeedCommentaryEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const inningsDiff = inningsRank(a.period) - inningsRank(b.period);
    if (inningsDiff !== 0) {
      return inningsDiff;
    }
    const seqA =
      typeof a.sequence === "number" ? a.sequence : Number.MAX_SAFE_INTEGER;
    const seqB =
      typeof b.sequence === "number" ? b.sequence : Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) {
      return seqA - seqB;
    }
    const minA =
      typeof a.minute === "number" ? a.minute : Number.MAX_SAFE_INTEGER;
    const minB =
      typeof b.minute === "number" ? b.minute : Number.MAX_SAFE_INTEGER;
    return minA - minB;
  });

  const grouped = new Map<number, SeedCommentaryEntry[]>();
  for (const entry of sorted) {
    const key = inningsRank(entry.period);
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = [];
      grouped.set(key, bucket);
    }
    bucket.push(entry);
  }

  const ordered: SeedCommentaryEntry[] = [];
  const inningsKeys = Array.from(grouped.keys()).sort((a, b) => a - b);

  for (const key of inningsKeys) {
    const inningsEntries = grouped.get(key) || [];
    const primaryTeam = inningsEntries.find(
      (entry) => entry.team === match.homeTeam || entry.team === match.awayTeam,
    )?.team;
    const secondaryTeam =
      primaryTeam === match.homeTeam ? match.awayTeam : match.homeTeam;

    const neutral = inningsEntries.filter(
      (entry) => !entry.team || entry.team === "neutral",
    );
    const primary = inningsEntries.filter(
      (entry) => entry.team === primaryTeam,
    );
    const secondary = inningsEntries.filter(
      (entry) => entry.team === secondaryTeam,
    );
    const other = inningsEntries.filter(
      (entry) =>
        entry.team &&
        entry.team !== "neutral" &&
        entry.team !== primaryTeam &&
        entry.team !== secondaryTeam,
    );

    ordered.push(...neutral, ...primary, ...secondary, ...other);
  }

  return ordered;
}

function replaceTrailingTeam(
  message: string | undefined,
  replacements: Map<string, string>,
): string | undefined {
  if (typeof message !== "string") {
    return message;
  }
  const match = message.match(/\(([^)]+)\)\s*$/);
  if (!match) {
    return message;
  }
  const teamName = match[1];
  if (!teamName) {
    return message;
  }
  const nextTeam = replacements.get(teamName);
  if (!nextTeam) {
    return message;
  }
  return message.replace(/\([^)]+\)\s*$/, `(${nextTeam})`);
}

function cloneCommentaryEntries(
  entries: SeedCommentaryEntry[],
  templateMatch: SeedMatch,
  targetMatch: SeedMatch,
): SeedCommentaryEntry[] {
  const replacements = new Map([
    [templateMatch.homeTeam, targetMatch.homeTeam],
    [templateMatch.awayTeam, targetMatch.awayTeam],
  ]);

  return entries.map((entry) => {
    const next = { ...entry, matchId: targetMatch.id };
    if (entry.team === templateMatch.homeTeam) {
      next.team = targetMatch.homeTeam;
    } else if (entry.team === templateMatch.awayTeam) {
      next.team = targetMatch.awayTeam;
    }
    const nextMessage = replaceTrailingTeam(entry.message, replacements);
    if (typeof nextMessage === "string") {
      next.message = nextMessage;
    }
    return next;
  });
}

function expandFeedForMatches(
  feed: SeedCommentaryEntry[],
  seedMatches: SeedMatch[],
): SeedCommentaryEntry[] {
  if (!Array.isArray(seedMatches) || seedMatches.length === 0) {
    return feed;
  }

  const byMatchId = new Map<number, SeedCommentaryEntry[]>();
  for (const entry of feed) {
    const matchId =
      typeof entry.matchId === "number" && Number.isInteger(entry.matchId)
        ? entry.matchId
        : null;
    if (matchId === null) {
      continue;
    }
    let entriesForMatch = byMatchId.get(matchId);
    if (!entriesForMatch) {
      entriesForMatch = [];
      byMatchId.set(matchId, entriesForMatch);
    }
    entriesForMatch.push(entry);
  }

  const templateBySport = new Map<string, SeedMatch>();
  for (const match of seedMatches) {
    if (!templateBySport.has(match.sport) && byMatchId.has(match.id)) {
      templateBySport.set(match.sport, match);
    }
  }

  const expanded = [...feed];
  for (const match of seedMatches) {
    if (byMatchId.has(match.id)) {
      continue;
    }
    const templateMatch = templateBySport.get(match.sport);
    if (!templateMatch) {
      continue;
    }
    const templateEntries = byMatchId.get(templateMatch.id) || [];
    expanded.push(
      ...cloneCommentaryEntries(templateEntries, templateMatch, match),
    );
  }

  return expanded;
}

function buildRandomizedFeed(
  feed: SeedCommentaryEntry[],
  matchMap: Map<number | string, MatchState>,
): SeedCommentaryEntry[] {
  const buckets = new Map<number | null, SeedCommentaryEntry[]>();
  for (const entry of feed) {
    const key =
      typeof entry.matchId === "number" && Number.isInteger(entry.matchId)
        ? entry.matchId
        : null;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(entry);
  }

  for (const [matchId, entries] of buckets) {
    if (typeof matchId !== "number" || !Number.isInteger(matchId)) {
      continue;
    }
    const target = matchMap.get(matchId);
    const sport = target?.match?.sport?.toLowerCase();
    if (sport === "cricket" && target?.match) {
      buckets.set(matchId, normalizeCricketFeed(entries, target.match));
    }
  }

  const matchIds = Array.from(buckets.keys());
  const randomized: SeedCommentaryEntry[] = [];
  let lastMatchId: number | null = null;

  while (randomized.length < feed.length) {
    const candidates = matchIds.filter(
      (id) => (buckets.get(id) || []).length > 0,
    );
    if (candidates.length === 0) {
      break;
    }

    let selectable = candidates;
    if (lastMatchId !== null && candidates.length > 1) {
      const withoutLast = candidates.filter((id) => id !== lastMatchId);
      if (withoutLast.length > 0) {
        selectable = withoutLast;
      }
    }

    const choice = selectable[Math.floor(Math.random() * selectable.length)];
    if (choice === undefined) {
      continue;
    }
    const nextEntries = buckets.get(choice);
    const nextEntry = nextEntries?.shift();
    if (!nextEntry) {
      continue;
    }
    randomized.push(nextEntry);
    lastMatchId = choice;
  }

  return randomized;
}

function getMatchEntry(
  entry: SeedCommentaryEntry,
  matchMap: Map<number | string, MatchState>,
): MatchState | null {
  const matchId =
    typeof entry.matchId === "number" && Number.isInteger(entry.matchId)
      ? entry.matchId
      : null;
  if (matchId === null) {
    return null;
  }
  return matchMap.get(matchId) ?? null;
}

async function updateMatchScore(
  matchId: string,
  homeScore: number,
  awayScore: number,
) {
  const response = await fetch(`${API_URL}/matches/${matchId}/score`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ homeScore, awayScore }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to update score: ${response.status} ${details}`);
  }
}

function randomMatchDelay() {
  const range = NEW_MATCH_DELAY_MAX_MS - NEW_MATCH_DELAY_MIN_MS;
  return NEW_MATCH_DELAY_MIN_MS + Math.floor(Math.random() * (range + 1));
}

// NOTE: Match status updates are not part of this codebase yet.
// async function endMatch(matchId) {
//   const response = await fetch(`${API_URL}/matches/${matchId}/end`, {
//     method: "PATCH",
//     headers: { "content-type": "application/json" },
//   });
//   if (!response.ok) {
//     throw new Error(`Failed to end match: ${response.status}`);
//   }
// }

async function seed() {
  console.log(`📡 Seeding via API: ${API_URL}`);

  const { feed, matches: seedMatches } = await loadSeedData();
  const matchesList = await fetchMatches();

  const matchMap = new Map<number | string, MatchState>();
  const matchKeyMap = new Map<string, ApiMatch>();
  for (const match of matchesList) {
    if (FORCE_LIVE && !isLiveMatch(match)) {
      continue;
    }
    const key = `${match.sport}|${match.homeTeam}|${match.awayTeam}`;
    if (!matchKeyMap.has(key)) {
      matchKeyMap.set(key, match);
    }
    matchMap.set(match.id, {
      match,
      score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
      fakeNext: Math.random() < 0.5 ? "home" : "away",
    });
  }

  if (Array.isArray(seedMatches) && seedMatches.length > 0) {
    for (const seedMatch of seedMatches) {
      const key = `${seedMatch.sport}|${seedMatch.homeTeam}|${seedMatch.awayTeam}`;
      let match = matchKeyMap.get(key);
      if (!match || (FORCE_LIVE && !isLiveMatch(match))) {
        match = await createMatch(seedMatch);
        matchKeyMap.set(key, match);
        const delayMs = randomMatchDelay();
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (Number.isInteger(seedMatch.id)) {
        matchMap.set(seedMatch.id, {
          match,
          score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
          fakeNext: Math.random() < 0.5 ? "home" : "away",
        });
      }
      matchMap.set(match.id, {
        match,
        score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
        fakeNext: Math.random() < 0.5 ? "home" : "away",
      });
    }
  }

  if (matchMap.size === 0) {
    throw new Error("No matches found or created in the database.");
  }

  // NOTE: Score resets are disabled because score updates are not supported.
  // const resetIds = new Set();
  // for (const entry of matchMap.values()) {
  //   const matchId = entry.match?.id;
  //   if (!Number.isInteger(matchId) || resetIds.has(matchId)) {
  //     continue;
  //   }
  //   resetIds.add(matchId);
  //   entry.score.home = 0;
  //   entry.score.away = 0;
  //   await updateMatchScore(matchId, 0, 0);
  // }

  const expandedFeed = expandFeedForMatches(feed, seedMatches);
  const randomizedFeed = buildRandomizedFeed(expandedFeed, matchMap);
  // NOTE: Remaining entry counts were used to end matches; disabled for now.
  // const remainingByMatchId = new Map();
  // for (const entry of randomizedFeed) {
  //   if (!Number.isInteger(entry.matchId)) {
  //     continue;
  //   }
  //   remainingByMatchId.set(
  //     entry.matchId,
  //     (remainingByMatchId.get(entry.matchId) || 0) + 1,
  //   );
  // }

  for (let i = 0; i < randomizedFeed.length; i += 1) {
    const entry = randomizedFeed[i];
    if (!entry) {
      continue;
    }
    const target = getMatchEntry(entry, matchMap);
    if (!target) {
      console.warn(
        "⚠️  Skipping entry: matchId missing or not found:",
        entry.message,
      );
      continue;
    }
    const match = target.match;

    const row = await insertCommentary(match.id, entry);
    console.log(`📣 [Match ${match.id}] ${row.message}`);

    const delta = scoreDeltaFromEntry(entry, match);
    if (delta && (delta.home !== 0 || delta.away !== 0)) {
      target.score.home += delta.home;
      target.score.away += delta.away;
      await updateMatchScore(match.id, target.score.home, target.score.away);
      console.log(
        `📊 [Match ${match.id}] Score updated: ${target.score.home}-${target.score.away}`,
      );
    }

    // NOTE: Match status updates are intentionally disabled in this codebase.
    // if (Number.isInteger(entry.matchId)) {
    //   const remaining = (remainingByMatchId.get(entry.matchId) || 1) - 1;
    //   if (remaining <= 0) {
    //     remainingByMatchId.delete(entry.matchId);
    //     await endMatch(match.id);
    //     console.log(`🏁 [Match ${match.id}] Match finished.`);
    //   } else {
    //     remainingByMatchId.set(entry.matchId, remaining);
    //   }
    // }

    if (DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }
}

seed().catch((err) => {
  console.error("❌ Seed error:", err);
  process.exit(1);
});
