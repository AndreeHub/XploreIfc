import type { IfcArgument, IfcEntity, IfcIndex, IfcSchemaName } from "../types/ifc";

export interface ParseOptions {
  classNameLookup?: Record<string, string>;
  includeRaw?: boolean;
  includeArgs?: boolean;
  includeRefs?: boolean;
}

const entityStartPattern = /#\d+\s*=/g;
const refPattern = /#\d+/g;
const emptyArgs: IfcArgument[] = [];
const emptyRefs: string[] = [];

export function parseIfcText(text: string, options: ParseOptions = {}): IfcIndex {
  const lineStarts = getLineStarts(text);
  const byId: Record<string, IfcEntity> = {};
  const byClass: Record<string, string[]> = {};
  const outgoing: Record<string, string[]> = {};
  const incoming: Record<string, string[]> = {};
  const classCounts: Record<string, number> = {};
  const orderedIds: string[] = [];
  const parseErrors: string[] = [];
  const schema = detectSchema(text);
  const includeRefs = options.includeRefs ?? true;

  entityStartPattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = entityStartPattern.exec(text)) !== null) {
    const start = match.index;
    const end = findEntityEnd(text, start);
    if (end === -1) {
      parseErrors.push(`Could not find entity terminator after ${match[0].trim()}`);
      continue;
    }

    const raw = text.slice(start, end);
    const entity = parseEntity(raw, start, lineStarts, options);
    if (!entity) {
      parseErrors.push(`Could not parse entity starting at offset ${start}`);
      entityStartPattern.lastIndex = end;
      continue;
    }

    byId[entity.id] = entity;
    orderedIds.push(entity.id);
    const classBucket = byClass[entity.className] ?? (byClass[entity.className] = []);
    classBucket.push(entity.id);
    classCounts[entity.className] = (classCounts[entity.className] ?? 0) + 1;
    if (includeRefs) {
      outgoing[entity.id] = entity.refs;
      entity.refs.forEach((ref) => {
        incoming[ref] ??= [];
        incoming[ref].push(entity.id);
      });
    }
    entityStartPattern.lastIndex = end;
  }

  return {
    schema,
    byId,
    byClass,
    outgoing,
    incoming,
    classCounts,
    orderedIds,
    parseErrors,
    lineCount: lineStarts.length,
    lineStarts
  };
}

export function detectSchema(text: string): IfcSchemaName {
  const schemaMatch = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
  const schema = schemaMatch?.[1]?.toUpperCase();
  if (!schema) return "UNKNOWN";
  if (schema.includes("IFC4X3")) return "IFC4X3";
  if (schema.includes("IFC4")) return "IFC4";
  if (schema.includes("IFC2X3")) return "IFC2X3";
  return "UNKNOWN";
}

export function getEntityAtPosition(index: IfcIndex, position: number): IfcEntity | undefined {
  let low = 0;
  let high = index.orderedIds.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const entity = index.byId[index.orderedIds[mid] ?? ""];
    if (!entity) return undefined;
    if (position < entity.start) high = mid - 1;
    else if (position > entity.end) low = mid + 1;
    else return entity;
  }

  return undefined;
}

export function getArgumentAtPosition(entity: IfcEntity, position: number): { argument: IfcArgument; index: number } | undefined {
  const argumentIndex = entity.args.findIndex((argument) => position >= argument.start && position <= argument.end);
  if (argumentIndex === -1) return undefined;
  const argument = entity.args[argumentIndex];
  return argument ? { argument, index: argumentIndex } : undefined;
}

export function hydrateIfcEntity(text: string, entity: IfcEntity, options: ParseOptions = {}): IfcEntity {
  if (entity.raw && entity.args.length > 0) return entity;
  const parsed = parseEntity(text.slice(entity.start, entity.end), entity.start, [], {
    ...options,
    includeRaw: true,
    includeArgs: true
  });
  return parsed ? { ...parsed, lineStart: entity.lineStart, lineEnd: entity.lineEnd } : entity;
}

export function getReferenceAtPosition(text: string, position: number): string | undefined {
  const left = text.slice(Math.max(0, position - 32), position + 32);
  const base = Math.max(0, position - 32);
  const matches = left.matchAll(/#\d+/g);
  for (const match of matches) {
    if (match.index === undefined) continue;
    const start = base + match.index;
    const end = start + match[0].length;
    if (position >= start && position <= end) return match[0];
  }
  return undefined;
}

function parseEntity(raw: string, absoluteStart: number, lineStarts: number[], options: ParseOptions = {}): IfcEntity | undefined {
  const headerMatch = raw.match(/^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/i);
  if (!headerMatch?.[1] || !headerMatch[2]) return undefined;

  const id = `#${headerMatch[1]}`;
  const rawClassName = headerMatch[2];
  const className = options.classNameLookup?.[rawClassName.toUpperCase()] ?? rawClassName.toUpperCase();
  const openParen = raw.indexOf("(", headerMatch[0].length - 1);
  const closeParen = findMatchingParen(raw, openParen);
  const includeArgs = options.includeArgs ?? true;
  const includeRaw = options.includeRaw ?? true;
  const args = includeArgs && closeParen !== -1 ? parseArguments(raw, absoluteStart, openParen + 1, closeParen) : emptyArgs;
  const includeRefs = options.includeRefs ?? true;
  const refs = includeRefs ? (includeArgs ? unique(args.flatMap((argument) => argument.refs)) : extractRefs(raw.slice(Math.max(0, openParen)))) : emptyRefs;
  const startLine = lineStarts.length ? offsetToLine(lineStarts, absoluteStart) : entityLineFallback(raw, "start");
  const endLine = lineStarts.length ? offsetToLine(lineStarts, absoluteStart + raw.length) : entityLineFallback(raw, "end");

  return {
    id,
    className,
    rawClassName,
    raw: includeRaw ? raw : "",
    start: absoluteStart,
    end: absoluteStart + raw.length,
    lineStart: startLine,
    lineEnd: endLine,
    args,
    refs
  };
}

function entityLineFallback(raw: string, point: "start" | "end"): number {
  if (point === "start") return 1;
  return raw.split("\n").length;
}

function parseArguments(raw: string, absoluteStart: number, argsStart: number, argsEnd: number): IfcArgument[] {
  const args: IfcArgument[] = [];
  let depth = 0;
  let inString = false;
  let currentStart = argsStart;

  for (let i = argsStart; i <= argsEnd; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];

    if (char === "'") {
      if (inString && next === "'") {
        i += 1;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (inString) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;

    const isDelimiter = (char === "," && depth === 0) || i === argsEnd;
    if (isDelimiter) {
      const localEnd = i === argsEnd ? i : i;
      const rawArg = raw.slice(currentStart, localEnd).trim();
      const leadingWhitespace = raw.slice(currentStart, localEnd).match(/^\s*/)?.[0].length ?? 0;
      const trailingWhitespace = raw.slice(currentStart, localEnd).match(/\s*$/)?.[0].length ?? 0;
      const start = absoluteStart + currentStart + leadingWhitespace;
      const end = absoluteStart + localEnd - trailingWhitespace;
      args.push({
        raw: rawArg,
        start,
        end,
        refs: extractRefs(rawArg)
      });
      currentStart = i + 1;
    }
  }

  return args;
}

function extractRefs(value: string): string[] {
  refPattern.lastIndex = 0;
  return unique([...value.matchAll(refPattern)].map((match) => match[0]));
}

function findEntityEnd(text: string, start: number): number {
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "'") {
      if (inString && next === "'") {
        i += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (!inString && char === ";") return i + 1;
  }
  return -1;
}

function findMatchingParen(raw: string, openParen: number): number {
  let depth = 0;
  let inString = false;
  for (let i = openParen; i < raw.length; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];
    if (char === "'") {
      if (inString && next === "'") {
        i += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function getLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid] ?? 0;
    if (lineStart <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(1, high + 1);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
