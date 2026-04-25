/**
 * Internal model + parser + serializer for FitKit workout notes.
 *
 * A workout note has YAML frontmatter with `type: workout`, a `date`, and a
 * `name`, followed by one or more `## [[Exercise Name]]` (or `## Exercise
 * Name`) sections. Each section has bullet rows that use inline Dataview
 * fields of the form `[key:: value]`.
 *
 * The canonical "truth" field in a bullet is `[exercise:: [[Name]]]`. If the
 * H2 and the inline exercise disagree we trust the inline and emit a warning.
 *
 * Bullet kinds:
 *  - Exercise-level note: has `[exercise::]` and optional `[notes::]` only.
 *  - Strength row: has `[set::]`, `[weight::]`, `[reps::]`, optional `[notes::]`.
 *  - Duration row: has `[duration::]` (seconds), optional `[set::]`, optional `[notes::]`.
 *
 * Fenced code blocks (triple-backtick) anywhere in the body are preserved
 * verbatim at their original line index and are skipped by the parser.
 */

export type ExerciseKind = 'strength' | 'duration';

export interface StrengthSet {
  set: number;
  weight: number;
  reps: number;
  note?: string;
}

export interface DurationEntry {
  set?: number;
  durationSeconds: number;
  note?: string;
}

export interface ExerciseEntry {
  exerciseName: string;
  kind: ExerciseKind;
  note?: string;
  strengthSets?: StrengthSet[];
  durationEntries?: DurationEntry[];
}

export interface PreserveBlock {
  /** 0-based line index in the re-serialized output where the block should be injected. */
  index: number;
  text: string;
}

export interface WorkoutNoteModel {
  date: string;
  name: string;
  sourcePath: string;
  exercises: ExerciseEntry[];
  preserveBlocks: PreserveBlock[];
}

export interface ParseResult {
  model: WorkoutNoteModel | null;
  /** True iff the note has frontmatter `type: workout`. */
  isWorkout: boolean;
  warnings: string[];
}

const FRONTMATTER_FENCE = /^---\s*$/;
const CODE_FENCE = /^```/;
const H2 = /^##\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
/**
 * Matches `[key:: value]` where `value` may itself contain `[[wikilinks]]`.
 * The value alternative accepts either a `[[...]]` run or any non-`]` char.
 */
const INLINE_FIELD = /\[([a-zA-Z][\w-]*)::\s*((?:\[\[[^\]]*\]\]|[^\]])*)\]/g;
const WIKILINK = /^\[\[([^\]]+)\]\]$/;

/**
 * Parse a markdown string. Returns a result that flags whether this is a
 * workout note (has `type: workout`) and, if so, the parsed model plus any
 * warnings (for example, H2 vs inline exercise name mismatches).
 */
export function parseWorkoutNote(source: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  const rawLines = source.split(/\r?\n/);
  const { frontmatter, frontmatterEnd } = readFrontmatter(rawLines);
  if (!frontmatter) {
    return { model: null, isWorkout: false, warnings };
  }
  if (frontmatter.get('type') !== 'workout') {
    return { model: null, isWorkout: false, warnings };
  }
  const date = frontmatter.get('date') ?? '';
  const name = frontmatter.get('name') ?? '';

  /** Walk the body. Strip fenced blocks first (preserving them verbatim). */
  const bodyLines = rawLines.slice(frontmatterEnd + 1);
  const { cleanedLines, preserveBlocks } = extractFencedBlocks(bodyLines);

  const exercises: ExerciseEntry[] = [];
  let currentHeadingName: string | null = null;
  let currentHeadingWarned = false;
  let current: ExerciseEntry | null = null;

  const flush = () => {
    if (current) {
      exercises.push(current);
      current = null;
    }
  };

  for (const line of cleanedLines) {
    if (line === null) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const h2 = trimmed.match(H2);
    if (h2 && h2[1] !== undefined) {
      flush();
      currentHeadingName = parseHeadingName(h2[1].trim());
      currentHeadingWarned = false;
      current = null;
      continue;
    }
    const bullet = trimmed.match(BULLET);
    if (!bullet || bullet[1] === undefined) {
      continue;
    }
    const fields = collectInlineFields(bullet[1]);
    const exerciseField = fields.get('exercise');
    if (!exerciseField) {
      continue;
    }
    const inlineName = unwrapWikiLink(exerciseField);
    if (currentHeadingName && inlineName !== currentHeadingName && !currentHeadingWarned) {
      warnings.push(
        `${sourcePath}: H2 "${currentHeadingName}" disagrees with inline exercise "${inlineName}"; trusting inline.`,
      );
      currentHeadingWarned = true;
    }

    const hasSet = fields.has('set');
    const hasWeight = fields.has('weight');
    const hasReps = fields.has('reps');
    const hasDuration = fields.has('duration');
    const note = fields.get('notes');
    if (!hasDuration && hasSet && (!hasWeight || !hasReps)) {
      const missing = [!hasWeight ? 'weight' : null, !hasReps ? 'reps' : null].filter(
        (value): value is string => value !== null,
      );
      warnings.push(
        `${sourcePath}: Strength row for "${inlineName}" is missing ${missing.join(' and ')}; round-trip would invent zero values.`,
      );
    }

    if (!current || current.exerciseName !== inlineName) {
      flush();
      const kind: ExerciseKind = hasDuration ? 'duration' : 'strength';
      current = {
        exerciseName: inlineName,
        kind,
        strengthSets: kind === 'strength' ? [] : undefined,
        durationEntries: kind === 'duration' ? [] : undefined,
      };
    }

    if (!hasSet && !hasDuration && !hasWeight && !hasReps) {
      /** Exercise-level note row. */
      if (note !== undefined) {
        current.note = note;
      }
      continue;
    }

    if (hasDuration) {
      if (current.kind !== 'duration') {
        current.kind = 'duration';
        current.durationEntries = current.durationEntries ?? [];
        if ((current.strengthSets ?? []).length > 0) {
          warnings.push(
            `${sourcePath}: Exercise "${inlineName}" has both strength and duration rows; dropping strength data.`,
          );
        }
        current.strengthSets = undefined;
      }
      const durationSeconds = Number(fields.get('duration'));
      const entry: DurationEntry = { durationSeconds };
      if (hasSet) {
        entry.set = Number(fields.get('set'));
      }
      if (note !== undefined) {
        entry.note = note;
      }
      current.durationEntries = current.durationEntries ?? [];
      current.durationEntries.push(entry);
      continue;
    }

    /** Strength row. We tolerate RPE and drop it; keep set/weight/reps/notes. */
    if (current.kind !== 'strength') {
      current.kind = 'strength';
      current.strengthSets = current.strengthSets ?? [];
      if ((current.durationEntries ?? []).length > 0) {
        warnings.push(
          `${sourcePath}: Exercise "${inlineName}" has both strength and duration rows; dropping duration data.`,
        );
      }
      current.durationEntries = undefined;
    }
    const setNum = Number(fields.get('set') ?? '0');
    const weight = Number(fields.get('weight') ?? '0');
    const reps = Number(fields.get('reps') ?? '0');
    const set: StrengthSet = { set: setNum, weight, reps };
    if (note !== undefined) {
      set.note = note;
    }
    current.strengthSets = current.strengthSets ?? [];
    current.strengthSets.push(set);
  }
  flush();

  for (const exercise of exercises) {
    if (exercise.kind !== 'strength') {
      continue;
    }
    const sets = exercise.strengthSets ?? [];
    for (let index = 0; index < sets.length; index += 1) {
      const expected = index + 1;
      const actual = sets[index]?.set;
      if (actual !== expected) {
        warnings.push(
          `${sourcePath}: Strength set numbers for "${exercise.exerciseName}" skip expected set ${expected}.`,
        );
        break;
      }
    }
  }

  return {
    model: {
      date,
      name,
      sourcePath,
      exercises,
      preserveBlocks,
    },
    isWorkout: true,
    warnings,
  };
}

/**
 * Serialize a model back into markdown using the canonical format.
 * Fenced blocks recorded in `preserveBlocks` are spliced back in at their
 * original line indices within the generated body.
 */
export function serializeWorkoutNote(model: WorkoutNoteModel): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('type: workout');
  lines.push(`date: ${model.date}`);
  lines.push(`name: ${model.name}`);
  lines.push('---');
  lines.push('');

  const bodyStart = lines.length;
  const bodyLines: string[] = [];
  for (let i = 0; i < model.exercises.length; i++) {
    const exercise = model.exercises[i];
    if (!exercise) {
      continue;
    }
    if (i > 0) {
      bodyLines.push('');
    }
    bodyLines.push(`## [[${exercise.exerciseName}]]`);
    bodyLines.push('');
    if (exercise.note !== undefined) {
      bodyLines.push(`- [exercise:: [[${exercise.exerciseName}]]] [notes:: ${exercise.note}]`);
    }
    if (exercise.kind === 'strength') {
      for (const set of exercise.strengthSets ?? []) {
        const parts = [
          `[exercise:: [[${exercise.exerciseName}]]]`,
          `[set:: ${set.set}]`,
          `[weight:: ${formatNumber(set.weight)}]`,
          `[reps:: ${set.reps}]`,
        ];
        if (set.note !== undefined) {
          parts.push(`[notes:: ${set.note}]`);
        }
        bodyLines.push(`- ${parts.join(' ')}`);
      }
    } else {
      for (const entry of exercise.durationEntries ?? []) {
        const parts = [`[exercise:: [[${exercise.exerciseName}]]]`];
        if (entry.set !== undefined) {
          parts.push(`[set:: ${entry.set}]`);
        }
        parts.push(`[duration:: ${formatNumber(entry.durationSeconds)}]`);
        if (entry.note !== undefined) {
          parts.push(`[notes:: ${entry.note}]`);
        }
        bodyLines.push(`- ${parts.join(' ')}`);
      }
    }
  }

  /** Inject preserveBlocks. Their index is the 0-based line position within the body they occupied originally. */
  const sortedBlocks = [...model.preserveBlocks].sort((a, b) => a.index - b.index);
  let offset = 0;
  for (const block of sortedBlocks) {
    const insertAt = Math.min(Math.max(block.index + offset, 0), bodyLines.length);
    const blockLines = block.text.split(/\r?\n/);
    bodyLines.splice(insertAt, 0, ...blockLines);
    offset += blockLines.length;
  }

  for (const line of bodyLines) {
    lines.push(line);
  }
  /** Ensure trailing newline for POSIX-friendly output. */
  void bodyStart;
  return lines.join('\n') + '\n';
}

/**
 * Canonicalize a model for equality comparison. Strips `sourcePath` and
 * `preserveBlocks` (those are positional, not semantic), and trims/normalizes
 * notes. Used by `semanticEqual`.
 */
export function canonicalizeForEquality(model: WorkoutNoteModel): unknown {
  return {
    date: model.date,
    name: model.name,
    exercises: model.exercises.map((ex) => ({
      exerciseName: ex.exerciseName,
      kind: ex.kind,
      note: ex.note,
      strengthSets: ex.strengthSets?.map((set) => ({
        set: set.set,
        weight: set.weight,
        reps: set.reps,
        note: set.note,
      })),
      durationEntries: ex.durationEntries?.map((entry) => ({
        set: entry.set,
        durationSeconds: entry.durationSeconds,
        note: entry.note,
      })),
    })),
  };
}

export function semanticEqual(a: WorkoutNoteModel, b: WorkoutNoteModel): boolean {
  return JSON.stringify(canonicalizeForEquality(a)) === JSON.stringify(canonicalizeForEquality(b));
}

/** Read the leading frontmatter block. Returns a map of key -> string value and the index of the closing `---`. */
function readFrontmatter(lines: string[]): {
  frontmatter: Map<string, string> | null;
  frontmatterEnd: number;
} {
  if (lines.length === 0 || !FRONTMATTER_FENCE.test(lines[0] ?? '')) {
    return { frontmatter: null, frontmatterEnd: -1 };
  }
  const map = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      break;
    }
    if (FRONTMATTER_FENCE.test(line)) {
      return { frontmatter: map, frontmatterEnd: i };
    }
    const match = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.*)$/);
    if (match && match[1] !== undefined && match[2] !== undefined) {
      map.set(match[1].trim(), match[2].trim());
    }
  }
  return { frontmatter: null, frontmatterEnd: -1 };
}

interface ExtractResult {
  /** Same length as input body lines. Lines that were inside a fenced block are replaced with `null`. */
  cleanedLines: Array<string | null>;
  preserveBlocks: PreserveBlock[];
}

/**
 * Locate triple-backtick fenced code blocks in the body. Replace their lines
 * with `null` (so the parser skips them) and record the original text and
 * start index so the serializer can re-insert them.
 */
function extractFencedBlocks(bodyLines: string[]): ExtractResult {
  const cleaned: Array<string | null> = bodyLines.map((l) => l);
  const blocks: PreserveBlock[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const line = cleaned[i];
    if (typeof line === 'string' && CODE_FENCE.test(line)) {
      const start = i;
      const fenceTokenMatch = line.match(/^(`{3,})/);
      const fenceToken = fenceTokenMatch?.[1] ?? '```';
      i++;
      while (i < cleaned.length) {
        const inner = cleaned[i];
        if (typeof inner === 'string' && inner.startsWith(fenceToken)) {
          i++;
          break;
        }
        i++;
      }
      const end = i;
      const blockText = bodyLines.slice(start, end).join('\n');
      for (let k = start; k < end; k++) {
        cleaned[k] = null;
      }
      blocks.push({ index: start, text: blockText });
      continue;
    }
    i++;
  }
  return { cleanedLines: cleaned, preserveBlocks: blocks };
}

function parseHeadingName(raw: string): string {
  const wiki = raw.match(WIKILINK);
  if (wiki && wiki[1] !== undefined) {
    return wiki[1].trim();
  }
  return raw.trim();
}

function unwrapWikiLink(raw: string): string {
  const trimmed = raw.trim();
  const wiki = trimmed.match(WIKILINK);
  if (wiki && wiki[1] !== undefined) {
    return wiki[1].trim();
  }
  return trimmed;
}

function collectInlineFields(bullet: string): Map<string, string> {
  const map = new Map<string, string>();
  INLINE_FIELD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_FIELD.exec(bullet)) !== null) {
    const key = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    map.set(key, value);
  }
  return map;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) {
    return String(n);
  }
  /** Render integers without decimal, floats with their natural representation. */
  return Number.isInteger(n) ? String(n) : String(n);
}
