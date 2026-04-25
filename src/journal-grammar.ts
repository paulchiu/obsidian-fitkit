/**
 * Deterministic grammar for converting rough journal notes into an internal
 * workout model. Produces structured warnings for anything ambiguous. Contains
 * no alias resolution; consumers do that against an ExerciseRegistry.
 */

export type SetRow = {
  kind: 'strength';
  weight: number;
  reps: number;
  /** Raw line text for trace or warnings. */
  raw: string;
};

export type DurationRow = {
  kind: 'duration';
  seconds: number;
  raw: string;
};

export type ExerciseRow = SetRow | DurationRow;

export type ParsedExercise = {
  /** Raw name as it appeared in the journal (before alias resolution). */
  rawName: string;
  /** Exercise-level note collected from pre-first-set non-set lines. */
  note: string;
  rows: ExerciseRow[];
};

export type JournalWarning = {
  /** The raw exercise name this warning belongs to, or null if workout-level. */
  exerciseRawName: string | null;
  message: string;
  sourceLine: string;
  lineNumber: number;
};

export type ParsedJournal = {
  name: string;
  date: string | null;
  exercises: ParsedExercise[];
  warnings: JournalWarning[];
};

const HEADING_LINE = /^#\s+(.+?)\s*$/;
const DATE_LINE = /^(\d{4}-\d{2}-\d{2})$/;
const EXERCISE_H2_WIKILINK = /^##\s+\[\[([^\]]+)\]\]\s*$/;
const EXERCISE_H2_PLAIN = /^##\s+(.+?)\s*$/;
const EXERCISE_BARE_WIKILINK = /^\[\[([^\]]+)\]\]\s*$/;
const EXERCISE_INLINE_ROW = /^(.+?)\s*:\s*(.+?)\s*$/;

/**
 * Strip optional leading ordinal like `1.` or `2)` so the remaining text is
 * ready for set/duration matching.
 */
function stripLeadingOrdinal(line: string): string {
  return line.replace(/^\s*\d+\s*[.)]\s*/, '').trim();
}

/**
 * Try to parse a strength set row. Accepts forms `W x R`, `W × R`, `W / R`,
 * and extra slash-separated numeric values. Extra slash values are tolerated
 * but dropped.
 */
function parseStrengthSet(line: string): SetRow | null {
  const body = stripLeadingOrdinal(line);
  const xMatch = body.match(/^(-?\d+(?:\.\d+)?)\s*[x×]\s*(-?\d+(?:\.\d+)?)\s*$/i);
  if (xMatch) {
    const weight = Number(xMatch[1]);
    const reps = Number(xMatch[2]);
    if (Number.isFinite(weight) && Number.isFinite(reps)) {
      return { kind: 'strength', weight, reps, raw: line };
    }
  }
  const slashParts = body.split('/').map((part) => part.trim());
  if (slashParts.length >= 2 && slashParts.every(isNumericToken)) {
    const weight = Number(slashParts[0]);
    const reps = Number(slashParts[1]);
    if (Number.isFinite(weight) && Number.isFinite(reps)) {
      return { kind: 'strength', weight, reps, raw: line };
    }
  }
  return null;
}

function isNumericToken(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}

/**
 * Try to parse a duration row. Accepts `60s`, `60 s`, `60sec`, `90m`, `90 min`,
 * `90mins`. Returns seconds.
 */
function parseDuration(line: string): DurationRow | null {
  const body = stripLeadingOrdinal(line);
  const secondsMatch = body.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\s*$/i);
  if (secondsMatch) {
    const value = Number(secondsMatch[1]);
    if (Number.isFinite(value)) {
      return { kind: 'duration', seconds: Math.round(value), raw: line };
    }
  }
  const minutesMatch = body.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\s*$/i);
  if (minutesMatch) {
    const value = Number(minutesMatch[1]);
    if (Number.isFinite(value)) {
      return { kind: 'duration', seconds: Math.round(value * 60), raw: line };
    }
  }
  return null;
}

function tryMatchExerciseHeading(line: string): string | null {
  const h2Wiki = line.match(EXERCISE_H2_WIKILINK);
  if (h2Wiki) {
    return h2Wiki[1]?.trim() ?? null;
  }
  const bareWiki = line.match(EXERCISE_BARE_WIKILINK);
  if (bareWiki) {
    return bareWiki[1]?.trim() ?? null;
  }
  const h2Plain = line.match(EXERCISE_H2_PLAIN);
  if (h2Plain) {
    const candidate = h2Plain[1]?.trim() ?? '';
    /** Avoid consuming the session-level `# Heading` which is H1. */
    if (!candidate.startsWith('#')) {
      return candidate;
    }
  }
  return null;
}

function tryParseInlineExerciseRow(line: string): ParsedExercise | null {
  const match = line.match(EXERCISE_INLINE_ROW);
  if (match) {
    return tryBuildInlineExercise(match[1]?.trim(), match[2]?.trim(), line);
  }

  return tryParseBareInlineExerciseRow(line);
}

function tryBuildInlineExercise(
  rawName: string | undefined,
  rowText: string | undefined,
  line: string,
): ParsedExercise | null {
  if (!rawName || !rowText) {
    return null;
  }

  const strength = parseStrengthSet(rowText);
  if (strength) {
    return {
      rawName,
      note: '',
      rows: [{ ...strength, raw: line }],
    };
  }

  const duration = parseDuration(rowText);
  if (duration) {
    return {
      rawName,
      note: '',
      rows: [{ ...duration, raw: line }],
    };
  }

  return null;
}

function tryParseBareInlineExerciseRow(line: string): ParsedExercise | null {
  const candidate = matchBareInlineExerciseRow(line);
  if (!candidate) {
    return null;
  }

  return tryBuildInlineExercise(candidate.rawName, candidate.rowText, line);
}

function matchBareInlineExerciseRow(line: string): { rawName: string; rowText: string } | null {
  const trimmed = line.trim();
  const matches = [
    trimmed.match(/^(.+?)\s+(-?\d+(?:\.\d+)?\s*[x×]\s*-?\d+(?:\.\d+)?)\s*$/i),
    trimmed.match(/^(.+?)\s+(-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)+)\s*$/),
    trimmed.match(
      /^(.+?)\s+(\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes))\s*$/i,
    ),
  ];

  for (const match of matches) {
    const rawName = match?.[1]?.trim();
    const rowText = match?.[2]?.trim();
    if (rawName && rowText && !isPurelyNumericText(rawName)) {
      return { rawName, rowText };
    }
  }

  return null;
}

function isPurelyNumericText(value: string): boolean {
  return /^[\d\s.+-]+$/.test(value.trim());
}

/**
 * Parse a journal file body into a deterministic model. Returns warnings for
 * lines that looked like data but did not fit the grammar.
 */
export function parseJournal(input: string): ParsedJournal {
  const lines = input.split(/\r?\n/);
  let name = 'Imported workout';
  let date: string | null = null;
  let sawTitle = false;
  const exercises: ParsedExercise[] = [];
  const warnings: JournalWarning[] = [];
  let current: ParsedExercise | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const line = rawLine.trim();
    const lineNumber = index + 1;

    if (line.length === 0) {
      continue;
    }

    if (!sawTitle) {
      const titleMatch = line.match(HEADING_LINE);
      if (titleMatch && !line.startsWith('##')) {
        name = (titleMatch[1] ?? 'Imported workout').trim() || 'Imported workout';
        sawTitle = true;
        continue;
      }
    }

    if (!current) {
      const dateMatch = line.match(DATE_LINE);
      if (dateMatch) {
        date = dateMatch[1] ?? null;
        continue;
      }
    }

    const inlineExercise = tryParseInlineExerciseRow(line);
    if (inlineExercise) {
      current = inlineExercise;
      exercises.push(current);
      continue;
    }

    const exerciseName = tryMatchExerciseHeading(line);
    if (exerciseName) {
      current = { rawName: exerciseName, note: '', rows: [] };
      exercises.push(current);
      continue;
    }

    if (!current) {
      /** Record content before any exercise heading as a workout-level warning. */
      warnings.push({
        exerciseRawName: null,
        message: 'Line before any exercise heading was ignored.',
        sourceLine: rawLine,
        lineNumber,
      });
      continue;
    }

    const strength = parseStrengthSet(line);
    if (strength) {
      current.rows.push(strength);
      continue;
    }

    const duration = parseDuration(line);
    if (duration) {
      current.rows.push(duration);
      continue;
    }

    /** Non-set, non-duration line. */
    if (current.rows.length === 0) {
      /** Join pre-set note lines into the exercise note. */
      current.note = current.note.length > 0 ? `${current.note} ${line}` : line;
    } else {
      warnings.push({
        exerciseRawName: current.rawName,
        message: 'Line after first set did not look like a set or duration.',
        sourceLine: rawLine,
        lineNumber,
      });
    }
  }

  return { name, date, exercises, warnings };
}
