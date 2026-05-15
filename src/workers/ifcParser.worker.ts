import { parseIfcText } from "../lib/ifcParser";
import { buildFilteredText, filterEntities } from "../lib/filtering";
import { classNameLookup } from "../lib/classNames";
import type { FilterChip, IfcEntity, IfcIndex, IfcLine, IfcSchemaName } from "../types/ifc";

const chunkSize = 4 * 1024 * 1024;
const maxQueryResults = 20_000;
const queryBatchBytes = 4 * 1024 * 1024;

interface EntityMeta {
  id: string;
  className: string;
  rawClassName: string;
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
}

interface HugeIndex {
  schema: IfcSchemaName;
  byId: Map<string, EntityMeta>;
  byClass: Map<string, string[]>;
  classCounts: Record<string, number>;
  orderedIds: string[];
  parseErrors: string[];
  lineOffsets: number[];
  fileSize: number;
}

interface PendingEntity {
  id: string;
  className: string;
  rawClassName: string;
  start: number;
  lineStart: number;
  parts: string[];
  inString: boolean;
}

type WorkerRequest = {
  type?: string;
  requestId?: number;
  text?: string;
  file?: File;
  filters?: FilterChip[];
  ids?: string[];
  key?: string;
  startLine?: number;
  count?: number;
  id?: string;
};

let currentText = "";
let currentIndex: IfcIndex | undefined;
let currentFile: File | undefined;
let hugeIndex: HugeIndex | undefined;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    if (event.data.type === "lineRange") {
      await handleLineRange(event.data);
      return;
    }

    if (event.data.type === "entity") {
      await handleEntity(event.data);
      return;
    }

    if (event.data.type === "query") {
      await handleQuery(event.data.filters ?? []);
      return;
    }

    if (event.data.type === "inverse") {
      await handleInverse(event.data.ids ?? [], event.data.key ?? "");
      return;
    }

    if (event.data.type === "parseFile" && event.data.file) {
      await handleParseFile(event.data.file);
      return;
    }

    await handleParseText(event.data.text ?? "");
  } catch (error) {
    if (event.data.requestId) {
      self.postMessage({
        type: "error",
        requestId: event.data.requestId,
        message: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

async function handleParseText(text: string) {
  currentText = text;
  currentFile = undefined;
  hugeIndex = undefined;
  currentIndex = parseIfcText(currentText, { classNameLookup });
  self.postMessage({ type: "ready", large: false, index: currentIndex });
}

async function handleParseFile(file: File) {
  currentText = "";
  currentFile = file;
  currentIndex = undefined;
  hugeIndex = await scanHugeFile(file);
  self.postMessage({
    type: "ready",
    large: true,
    summary: {
      schema: hugeIndex.schema,
      classCounts: hugeIndex.classCounts,
      totalEntities: hugeIndex.orderedIds.length,
      lineCount: hugeIndex.lineOffsets.length,
      parseErrors: hugeIndex.parseErrors
    }
  });
}

async function handleQuery(filters: FilterChip[]) {
  if (hugeIndex && currentFile) {
    const { entities, total } = await queryHuge(filters);
    self.postMessage({
      type: "query",
      entities,
      total,
      truncated: total > entities.length,
      text: buildFilteredText(entities)
    });
    return;
  }

  if (!currentIndex) return;
  const allEntities = filterEntities(currentIndex, filters, currentText);
  const entities = allEntities.slice(0, maxQueryResults);
  self.postMessage({
    type: "query",
    entities,
    total: allEntities.length,
    truncated: allEntities.length > entities.length,
    text: buildFilteredText(entities, currentText)
  });
}

async function handleInverse(ids: string[], key: string) {
  const targetIds = new Set(ids.map(normalizeId).filter(Boolean));
  if (!targetIds.size) {
    self.postMessage({ type: "inverse", key, entities: [], total: 0, truncated: false });
    return;
  }

  if (hugeIndex && currentFile) {
    const { entities, total } = await inverseHuge(targetIds);
    self.postMessage({
      type: "inverse",
      key,
      entities,
      total,
      truncated: total > entities.length
    });
    return;
  }

  if (!currentIndex) return;
  const idsToHydrate = [...targetIds].flatMap((id) => currentIndex?.incoming[id] ?? []);
  const uniqueIds = [...new Set(idsToHydrate)];
  const entities = uniqueIds
    .map((id) => currentIndex?.byId[id])
    .filter((entity): entity is IfcEntity => Boolean(entity))
    .slice(0, maxQueryResults);
  self.postMessage({ type: "inverse", key, entities, total: uniqueIds.length, truncated: uniqueIds.length > entities.length });
}

async function handleLineRange(request: WorkerRequest) {
  if (!currentFile || !hugeIndex || !request.requestId) return;
  const startLine = clamp(Math.floor(request.startLine ?? 0), 0, Math.max(0, hugeIndex.lineOffsets.length - 1));
  const count = clamp(Math.ceil(request.count ?? 120), 1, 1000);
  const endLine = Math.min(hugeIndex.lineOffsets.length, startLine + count);
  const startByte = hugeIndex.lineOffsets[startLine] ?? currentFile.size;
  const endByte = hugeIndex.lineOffsets[endLine] ?? currentFile.size;
  const text = await currentFile.slice(startByte, endByte).text();
  const lines = rangeTextToLines(text, startLine, endLine, hugeIndex.lineOffsets);
  self.postMessage({ type: "lineRange", requestId: request.requestId, lines });
}

async function handleEntity(request: WorkerRequest) {
  if (!currentFile || !hugeIndex || !request.requestId || !request.id) return;
  const meta = hugeIndex.byId.get(normalizeId(request.id));
  const entity = meta ? await hydrateMeta(meta) : null;
  self.postMessage({ type: "entity", requestId: request.requestId, entity });
}

async function scanHugeFile(file: File): Promise<HugeIndex> {
  const lineOffsets = [0];
  const byId = new Map<string, EntityMeta>();
  const byClass = new Map<string, string[]>();
  const classCounts: Record<string, number> = {};
  const orderedIds: string[] = [];
  const parseErrors: string[] = [];
  let schema: IfcSchemaName = "UNKNOWN";
  let pendingLine = new Uint8Array(0);
  let pendingLineStart = 0;
  let currentEntity: PendingEntity | undefined;
  let lineNumber = 1;
  let lastProgress = 0;

  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunkEnd = Math.min(file.size, offset + chunkSize);
    const bytes = new Uint8Array(await file.slice(offset, chunkEnd).arrayBuffer());
    let segmentStart = 0;

    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] !== 10) continue;
      const lineEnd = offset + i + 1;
      lineOffsets.push(lineEnd);
      const lineBytes = mergeLineBytes(pendingLine, bytes.subarray(segmentStart, i + 1));
      const lineText = decodeLine(lineBytes);
      schema = schema === "UNKNOWN" ? detectSchemaLine(lineText) : schema;
      currentEntity = processEntityLine(lineText, pendingLineStart, lineNumber, currentEntity, {
        byId,
        byClass,
        classCounts,
        orderedIds,
        parseErrors
      });
      pendingLine = new Uint8Array(0);
      segmentStart = i + 1;
      pendingLineStart = offset + segmentStart;
      lineNumber += 1;
    }

    if (segmentStart < bytes.length) {
      const remainder = copyBytes(bytes.subarray(segmentStart));
      pendingLine = pendingLine.length ? concatBytes(pendingLine, remainder) : remainder;
    }
    if (!pendingLine.length) pendingLineStart = chunkEnd;

    if (chunkEnd - lastProgress >= chunkSize * 4 || chunkEnd === file.size) {
      lastProgress = chunkEnd;
      self.postMessage({ type: "progress", loadedBytes: chunkEnd, totalBytes: file.size });
    }
  }

  if (pendingLine.length) {
    const lineText = decodeLine(pendingLine);
    schema = schema === "UNKNOWN" ? detectSchemaLine(lineText) : schema;
    currentEntity = processEntityLine(lineText, pendingLineStart, lineNumber, currentEntity, {
      byId,
      byClass,
      classCounts,
      orderedIds,
      parseErrors
    });
  }

  if (currentEntity) parseErrors.push(`Unterminated entity ${currentEntity.id}`);

  return {
    schema,
    byId,
    byClass,
    classCounts,
    orderedIds,
    parseErrors,
    lineOffsets,
    fileSize: file.size
  };
}

function processEntityLine(
  lineText: string,
  lineStartByte: number,
  lineNumber: number,
  currentEntity: PendingEntity | undefined,
  index: Pick<HugeIndex, "byId" | "byClass" | "classCounts" | "orderedIds" | "parseErrors">
): PendingEntity | undefined {
  let entity = currentEntity;
  let segment = lineText;
  let segmentStartByte = lineStartByte;

  if (!entity) {
    const match = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/i.exec(lineText);
    if (!match?.[1] || !match[2]) return undefined;
    const rawClassName = match[2];
    const className = classNameLookup[rawClassName.toUpperCase()] ?? rawClassName.toUpperCase();
    entity = {
      id: `#${match[1]}`,
      className,
      rawClassName,
      start: lineStartByte + (match.index ?? 0),
      lineStart: lineNumber,
      parts: [],
      inString: false
    };
    segment = lineText.slice(match.index ?? 0);
    segmentStartByte = entity.start;
  }

  const terminator = findTerminator(segment, entity.inString);
  entity.parts.push(terminator.index === -1 ? segment : segment.slice(0, terminator.index + 1));
  entity.inString = terminator.inString;

  if (terminator.index === -1) return entity;

  const meta: EntityMeta = {
    id: entity.id,
    className: entity.className,
    rawClassName: entity.rawClassName,
    start: entity.start,
    end: segmentStartByte + terminator.index + 1,
    lineStart: entity.lineStart,
    lineEnd: lineNumber
  };
  addMeta(index, meta);
  return undefined;
}

function addMeta(
  index: Pick<HugeIndex, "byId" | "byClass" | "classCounts" | "orderedIds" | "parseErrors">,
  meta: EntityMeta
) {
  if (index.byId.has(meta.id)) index.parseErrors.push(`Duplicate entity id ${meta.id}`);
  index.byId.set(meta.id, meta);
  index.orderedIds.push(meta.id);
  const classBucket = index.byClass.get(meta.className) ?? [];
  classBucket.push(meta.id);
  index.byClass.set(meta.className, classBucket);
  index.classCounts[meta.className] = (index.classCounts[meta.className] ?? 0) + 1;
}

async function queryHuge(filters: FilterChip[]): Promise<{ entities: IfcEntity[]; total: number }> {
  if (!currentFile || !hugeIndex) return { entities: [], total: 0 };
  if (filters.length === 0) return { entities: [], total: 0 };

  const textFilters = filters.filter((filter) => filter.type === "text");
  const indexedIds = collectIndexedIds(filters);

  if (textFilters.length === 0) {
    const metas = [...indexedIds]
      .map((id) => hugeIndex?.byId.get(id))
      .filter((meta): meta is EntityMeta => Boolean(meta))
      .sort((a, b) => a.start - b.start);
    return { entities: await hydrateMetas(metas.slice(0, maxQueryResults)), total: metas.length };
  }

  const terms = textFilters.map((filter) => filter.value.toLowerCase());
  const entities: IfcEntity[] = [];
  let total = 0;
  await forEachEntityRawBatch((meta, raw) => {
    if (!indexedIds.has(meta.id) && !terms.some((term) => raw.toLowerCase().includes(term))) return;
    total += 1;
    if (entities.length < maxQueryResults) entities.push(entityFromRaw(meta, raw));
  });

  return { entities, total };
}

async function inverseHuge(targetIds: Set<string>): Promise<{ entities: IfcEntity[]; total: number }> {
  const entities: IfcEntity[] = [];
  let total = 0;

  await forEachEntityRawBatch((meta, raw) => {
    const refs = extractRefs(raw);
    if (!refs.some((ref) => targetIds.has(ref) && ref !== meta.id)) return;
    total += 1;
    if (entities.length < maxQueryResults) entities.push(entityFromRaw(meta, raw));
  });

  return { entities, total };
}

function collectIndexedIds(filters: FilterChip[]) {
  const ids = new Set<string>();
  if (!hugeIndex) return ids;

  filters.forEach((filter) => {
    if (filter.type === "id" && hugeIndex?.byId.has(filter.value)) ids.add(filter.value);
    if (filter.type === "class") {
      const canonical = classNameLookup[filter.value.toUpperCase()] ?? filter.value;
      (hugeIndex?.byClass.get(canonical) ?? hugeIndex?.byClass.get(canonical.toUpperCase()) ?? []).forEach((id) => ids.add(id));
    }
  });
  return ids;
}

async function forEachEntityRawBatch(callback: (meta: EntityMeta, raw: string) => void | Promise<void>) {
  if (!currentFile || !hugeIndex) return;
  let batch: EntityMeta[] = [];
  let batchStart = 0;
  let batchEnd = 0;

  async function flush() {
    if (!batch.length || !currentFile) return;
    const text = await currentFile.slice(batchStart, batchEnd).text();
    for (const meta of batch) {
      await callback(meta, text.slice(meta.start - batchStart, meta.end - batchStart));
    }
    batch = [];
  }

  for (const id of hugeIndex.orderedIds) {
    const meta = hugeIndex.byId.get(id);
    if (!meta) continue;
    if (!batch.length) {
      batchStart = meta.start;
      batchEnd = meta.end;
    }
    if (meta.end - batchStart > queryBatchBytes) {
      await flush();
      batchStart = meta.start;
      batchEnd = meta.end;
    }
    batch.push(meta);
    batchEnd = Math.max(batchEnd, meta.end);
  }
  await flush();
}

async function hydrateMetas(metas: EntityMeta[]) {
  const entities: IfcEntity[] = [];
  for (const meta of metas) {
    entities.push(await hydrateMeta(meta));
  }
  return entities;
}

async function hydrateMeta(meta: EntityMeta): Promise<IfcEntity> {
  if (!currentFile) return entityFromRaw(meta, "");
  const raw = await currentFile.slice(meta.start, meta.end).text();
  return entityFromRaw(meta, raw);
}

function entityFromRaw(meta: EntityMeta, raw: string): IfcEntity {
  const parsed = raw ? parseIfcText(raw, { classNameLookup }).byId[meta.id] : undefined;
  if (parsed) {
    return {
      ...parsed,
      raw,
      start: meta.start,
      end: meta.end,
      lineStart: meta.lineStart,
      lineEnd: meta.lineEnd
    };
  }

  return {
    id: meta.id,
    className: meta.className,
    rawClassName: meta.rawClassName,
    raw,
    start: meta.start,
    end: meta.end,
    lineStart: meta.lineStart,
    lineEnd: meta.lineEnd,
    args: [],
    refs: extractRefs(raw).filter((id) => id !== meta.id)
  };
}

function rangeTextToLines(text: string, startLine: number, endLine: number, lineOffsets: number[]): IfcLine[] {
  const rawLines = text.split("\n");
  if (rawLines.at(-1) === "") rawLines.pop();
  return rawLines.slice(0, Math.max(0, endLine - startLine)).map((line, index) => ({
    lineNumber: startLine + index,
    text: line.endsWith("\r") ? line.slice(0, -1) : line,
    start: lineOffsets[startLine + index] ?? 0
  }));
}

function findTerminator(text: string, initialInString: boolean) {
  let inString = initialInString;
  for (let i = 0; i < text.length; i += 1) {
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
    if (!inString && char === ";") return { index: i, inString };
  }
  return { index: -1, inString };
}

function detectSchemaLine(line: string): IfcSchemaName {
  const schemaMatch = line.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
  const schema = schemaMatch?.[1]?.toUpperCase();
  if (!schema) return "UNKNOWN";
  if (schema.includes("IFC4X3")) return "IFC4X3";
  if (schema.includes("IFC4")) return "IFC4";
  if (schema.includes("IFC2X3")) return "IFC2X3";
  return "UNKNOWN";
}

function decodeLine(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes).replace(/\r?\n$/, "");
}

function mergeLineBytes(left: Uint8Array, right: Uint8Array) {
  if (!left.length) return right;
  return concatBytes(left, right);
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
}

function copyBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

function normalizeId(id: string) {
  const match = id.match(/^#?(\d+)$/);
  return match?.[1] ? `#${match[1]}` : id;
}

function extractRefs(value: string): string[] {
  return [...new Set([...value.matchAll(/#\d+/g)].map((match) => match[0]))];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
