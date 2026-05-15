import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import type { IfcIndex, IfcLine, IfcTextSource, ReferenceClick } from "../types/ifc";
import { buildHoverInfo, attributeForArgument } from "../lib/schema";
import { getArgumentAtPosition, getEntityAtPosition, getReferenceAtPosition, hydrateIfcEntity } from "../lib/ifcParser";
import { ifcHighlightExtension } from "../lib/ifcHighlight";

interface IfcEditorProps {
  text: string;
  source?: IfcTextSource | null;
  index: IfcIndex;
  fullIndex: IfcIndex;
  selectedId?: string;
  onSelectEntity: (id: string) => void;
  onReferenceClick: (click: ReferenceClick) => void;
}

const largeTextThreshold = 5 * 1024 * 1024;
const virtualLineHeight = 20;
const virtualOverscan = 12;
const maxRealScrollHeight = 5_000_000;

export function IfcEditor({ text, source, index, fullIndex, selectedId, onSelectEntity, onReferenceClick }: IfcEditorProps) {
  if (source && !text) {
    return (
      <VirtualIfcSourceViewer
        text={text}
        source={source}
        index={index}
        fullIndex={fullIndex}
        selectedId={selectedId}
        onSelectEntity={onSelectEntity}
        onReferenceClick={onReferenceClick}
      />
    );
  }

  if (text.length > largeTextThreshold) {
    return (
      <VirtualIfcViewer
        text={text}
        index={index}
        fullIndex={fullIndex}
        selectedId={selectedId}
        onSelectEntity={onSelectEntity}
        onReferenceClick={onReferenceClick}
      />
    );
  }

  return (
    <CodeMirrorIfcViewer
      text={text}
      index={index}
      fullIndex={fullIndex}
      selectedId={selectedId}
      onSelectEntity={onSelectEntity}
      onReferenceClick={onReferenceClick}
    />
  );
}

function CodeMirrorIfcViewer({ text, index, fullIndex, selectedId, onSelectEntity, onReferenceClick }: IfcEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const clickExtension = EditorView.domEventHandlers({
      click: (event, view) => {
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null) return false;
        const refId = getReferenceAtPosition(text, position);
        const entity = getEntityAtPosition(index, position);
        const hydrated = entity ? hydrateIfcEntity(text, entity) : undefined;
        if (refId && hydrated) {
          const argument = getArgumentAtPosition(hydrated, position);
          const attribute = typeof argument?.index === "number" ? attributeForArgument(index.schema, hydrated.className, argument.index) : undefined;
          onReferenceClick({
            refId,
            sourceId: hydrated.id,
            argumentIndex: argument?.index,
            attributeName: attribute?.name
          });
          return true;
        }
        if (hydrated) {
          onSelectEntity(hydrated.id);
          return true;
        }
        return false;
      }
    });

    const hoverExtension = hoverTooltip((_view, position) => {
      const entity = getEntityAtPosition(index, position);
      if (!entity) return null;
      const hydrated = hydrateIfcEntity(text, entity);
      const argument = getArgumentAtPosition(hydrated, position);
      const refId = getReferenceAtPosition(text, position);
      const fullEntity = hydrateIfcEntity(text, fullIndex.byId[hydrated.id] ?? hydrated);
      const info = buildHoverInfo(fullIndex, fullEntity, argument?.index, refId);
      const dom = document.createElement("div");
      dom.className = "ifc-tooltip";
      dom.innerHTML = tooltipHtml(info, argument?.argument.raw);
      return {
        pos: argument?.argument.start ?? hydrated.start,
        end: argument?.argument.end ?? hydrated.end,
        above: true,
        create: () => ({ dom })
      };
    });

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          keymap.of([...defaultKeymap, ...searchKeymap]),
          ifcHighlightExtension(),
          hoverExtension,
          clickExtension,
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace" }
          })
        ]
      })
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [fullIndex, index, onReferenceClick, onSelectEntity, text]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !selectedId) return;
    const entity = index.byId[selectedId];
    if (!entity) return;
    view.dispatch({
      selection: { anchor: entity.start },
      effects: EditorView.scrollIntoView(entity.start, { y: "center" })
    });
    view.focus();
  }, [index, selectedId]);

  return <div ref={hostRef} className="editor-host" data-testid="ifc-editor" />;
}

function VirtualIfcViewer({ text, index, fullIndex, selectedId, onSelectEntity, onReferenceClick }: IfcEditorProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lineStarts = useMemo(() => (index.lineStarts.length ? index.lineStarts : buildLineStarts(text)), [index.lineStarts, text]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(scroller);
    setViewportHeight(scroller.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !selectedId) return;
    const entity = index.byId[selectedId];
    if (!entity) return;
    scroller.scrollTop = Math.max(0, (entity.lineStart - 1) * virtualLineHeight - viewportHeight * 0.35);
  }, [index, selectedId, viewportHeight]);

  const firstLine = Math.max(0, Math.floor(scrollTop / virtualLineHeight) - virtualOverscan);
  const visibleCount = Math.ceil(viewportHeight / virtualLineHeight) + virtualOverscan * 2;
  const lastLine = Math.min(lineStarts.length - 1, firstLine + visibleCount);
  const rows: ReactNode[] = [];

  for (let lineIndex = firstLine; lineIndex <= lastLine; lineIndex += 1) {
    const line = sliceLine(text, lineStarts, lineIndex);
    const absoluteStart = lineStarts[lineIndex] ?? 0;
    rows.push(
      <div key={lineIndex} className="virtual-line" style={{ top: lineIndex * virtualLineHeight } satisfies CSSProperties}>
        <span className="virtual-line-number">{lineIndex + 1}</span>
        <code
          onClick={(event) => {
            const target = event.target as HTMLElement;
            const refId = target.dataset.ref;
            const position = Number(target.dataset.pos);
            const entity = Number.isFinite(position) ? getEntityAtPosition(index, position) : entityAtLine(index, lineIndex + 1);
            const hydrated = entity ? hydrateIfcEntity(text, entity) : parseVirtualLineEntity(line, absoluteStart, lineIndex + 1);
            if (refId && hydrated) {
              const argument = Number.isFinite(position) ? getArgumentAtPosition(hydrated, position) : undefined;
              const attribute = typeof argument?.index === "number" ? attributeForArgument(index.schema, hydrated.className, argument.index) : undefined;
              onReferenceClick({ refId, sourceId: hydrated.id, argumentIndex: argument?.index, attributeName: attribute?.name });
              return;
            }
            if (hydrated) onSelectEntity(hydrated.id);
          }}
        >
          {highlightVirtualLine(line, absoluteStart, index, fullIndex)}
        </code>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="editor-host virtual-host"
      data-testid="ifc-editor"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="virtual-spacer" style={{ height: lineStarts.length * virtualLineHeight } satisfies CSSProperties}>
        {rows}
      </div>
    </div>
  );
}

function VirtualIfcSourceViewer({ source, index, fullIndex, selectedId, onSelectEntity, onReferenceClick }: IfcEditorProps & { source: IfcTextSource }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [lineCount, setLineCount] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [visibleLines, setVisibleLines] = useState<IfcLine[]>([]);
  const [renderTop, setRenderTop] = useState(0);

  useEffect(() => {
    let cancelled = false;
    source
      .getLineCountEstimate()
      .then((count) => {
        if (!cancelled) setLineCount(count);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(scroller);
    setViewportHeight(scroller.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!lineCount) return undefined;
    const visibleCount = Math.ceil(viewportHeight / virtualLineHeight) + virtualOverscan * 2;
    const firstLine = Math.max(0, logicalLineFromScroll(scrollTop, lineCount) - virtualOverscan);
    const nextRenderTop = Math.max(0, scrollTop - virtualOverscan * virtualLineHeight);
    let cancelled = false;
    source
      .getLineRange(firstLine, visibleCount)
      .then((lines) => {
        if (!cancelled) {
          setVisibleLines(lines);
          setRenderTop(nextRenderTop);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lineCount, scrollTop, source, viewportHeight]);

  useEffect(() => {
    if (!selectedId || !lineCount) return;
    source
      .getEntityById(selectedId)
      .then((entity) => {
        const scroller = scrollerRef.current;
        if (!entity || !scroller) return;
        scroller.scrollTop = scrollFromLogicalLine(Math.max(0, entity.lineStart - 1), lineCount, viewportHeight);
      })
      .catch(() => undefined);
  }, [lineCount, selectedId, source, viewportHeight]);

  const totalHeight = virtualHeight(lineCount);
  const firstRenderedLine = visibleLines[0]?.lineNumber ?? 0;

  return (
    <div
      ref={scrollerRef}
      className="editor-host virtual-host"
      data-testid="ifc-editor"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="virtual-spacer" style={{ height: totalHeight } satisfies CSSProperties}>
        {visibleLines.map((line) => (
          <div
            key={line.lineNumber}
            className="virtual-line"
            style={{ top: renderTop + (line.lineNumber - firstRenderedLine) * virtualLineHeight } satisfies CSSProperties}
          >
            <span className="virtual-line-number">{line.lineNumber + 1}</span>
            <code
              onClick={(event) => {
                const target = event.target as HTMLElement;
                const refId = target.dataset.ref;
                const hydrated = parseVirtualLineEntity(line.text, line.start, line.lineNumber + 1);
                if (refId && hydrated) {
                  onReferenceClick({ refId, sourceId: hydrated.id });
                  return;
                }
                if (hydrated) onSelectEntity(hydrated.id);
              }}
            >
              {highlightVirtualLine(line.text, line.start, index, fullIndex)}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseVirtualLineEntity(line: string, absoluteStart: number, lineNumber: number) {
  const match = line.match(/^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/i);
  if (!match?.[1] || !match[2]) return undefined;
  return {
    id: `#${match[1]}`,
    className: match[2].toUpperCase(),
    rawClassName: match[2],
    raw: line,
    start: absoluteStart,
    end: absoluteStart + line.length,
    lineStart: lineNumber,
    lineEnd: lineNumber,
    args: [],
    refs: [...new Set([...line.matchAll(/#\d+/g)].map((refMatch) => refMatch[0]).filter((id) => id !== `#${match[1]}`))]
  };
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function sliceLine(text: string, lineStarts: number[], lineIndex: number): string {
  const start = lineStarts[lineIndex] ?? 0;
  const nextStart = lineStarts[lineIndex + 1] ?? text.length;
  const end = text.charCodeAt(nextStart - 2) === 13 ? nextStart - 2 : nextStart - 1;
  return text.slice(start, Math.max(start, end));
}

function entityAtLine(index: IfcIndex, lineNumber: number) {
  let low = 0;
  let high = index.orderedIds.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const entity = index.byId[index.orderedIds[mid] ?? ""];
    if (!entity) return undefined;
    if (lineNumber < entity.lineStart) high = mid - 1;
    else if (lineNumber > entity.lineEnd) low = mid + 1;
    else return entity;
  }
  return undefined;
}

function highlightVirtualLine(line: string, absoluteStart: number, index: IfcIndex, fullIndex: IfcIndex): ReactNode[] {
  const tokens = collectVirtualTokens(line);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  tokens.forEach((token, tokenIndex) => {
    if (token.start < cursor) return;
    if (token.start > cursor) nodes.push(line.slice(cursor, token.start));
    const value = line.slice(token.start, token.end);
    const position = absoluteStart + token.start;
    const entity = getEntityAtPosition(index, position);
    const hydrated = entity ? hydrateIfcEntity(line, { ...entity, start: 0, end: line.length }) : undefined;
    const argument = hydrated ? getArgumentAtPosition(hydrated, token.start) : undefined;
    const refId = token.type === "reference" || token.type === "entityId" ? value : undefined;
    const fullEntity = entity ? fullIndex.byId[entity.id] ?? entity : undefined;
    const info = fullEntity ? buildHoverInfo(fullIndex, fullEntity, argument?.index, refId) : undefined;
    nodes.push(
      <span
        key={`${token.start}-${token.end}-${tokenIndex}`}
        className={`cm-ifc-${token.type === "entityId" ? "entity-id" : token.type}`}
        data-ref={token.type === "reference" ? value : undefined}
        data-pos={position}
        title={info?.attributeName ?? info?.className}
      >
        {value}
      </span>
    );
    cursor = token.end;
  });

  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}

interface VirtualToken {
  start: number;
  end: number;
  type: "section" | "entityId" | "class" | "reference" | "string" | "enum" | "number" | "placeholder";
}

function collectVirtualTokens(line: string): VirtualToken[] {
  const tokens: VirtualToken[] = [];
  collect(line, /#\d+(?=\s*=)/g, "entityId", tokens);
  collectClass(line, tokens);
  collect(line, /\b(?:ISO-10303-21|HEADER|DATA|ENDSEC|END-ISO-10303-21)\b/g, "section", tokens);
  collect(line, /'([^']|'')*'/g, "string", tokens);
  collect(line, /#\d+/g, "reference", tokens);
  collect(line, /\.[A-Z0-9_]+\./g, "enum", tokens);
  collect(line, /[$*]/g, "placeholder", tokens);
  collect(line, /(?:^|[,(=\s])([-+]?(?:\d+\.\d*|\d+|\.\d+)(?:[Ee][-+]?\d+)?)/g, "number", tokens, 1);
  return tokens.sort((a, b) => a.start - b.start || a.end - b.end).filter(nonOverlapping());
}

function collect(line: string, pattern: RegExp, type: VirtualToken["type"], tokens: VirtualToken[], group = 0) {
  for (const match of line.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const value = match[group];
    if (!value) continue;
    const groupOffset = group === 0 ? 0 : match[0].indexOf(value);
    const start = match.index + groupOffset;
    tokens.push({ start, end: start + value.length, type });
  }
}

function collectClass(line: string, tokens: VirtualToken[]) {
  for (const match of line.matchAll(/=\s*([A-Z][A-Z0-9_]*)\s*\(/g)) {
    if (match.index === undefined || !match[1]) continue;
    const start = match.index + match[0].indexOf(match[1]);
    tokens.push({ start, end: start + match[1].length, type: "class" });
  }
}

function nonOverlapping() {
  let lastEnd = -1;
  return (token: VirtualToken) => {
    if (token.start < lastEnd) return false;
    lastEnd = token.end;
    return true;
  };
}

function virtualHeight(lineCount: number) {
  return Math.min(Math.max(lineCount * virtualLineHeight, virtualLineHeight), maxRealScrollHeight);
}

function logicalLineFromScroll(scrollTop: number, lineCount: number) {
  const realHeight = virtualHeight(lineCount);
  const logicalHeight = lineCount * virtualLineHeight;
  if (logicalHeight <= realHeight) return Math.floor(scrollTop / virtualLineHeight);
  return Math.floor((scrollTop / Math.max(1, realHeight)) * lineCount);
}

function scrollFromLogicalLine(lineNumber: number, lineCount: number, viewportHeight: number) {
  const realHeight = virtualHeight(lineCount);
  const logicalHeight = lineCount * virtualLineHeight;
  const centeredLine = Math.max(0, lineNumber - Math.floor(viewportHeight / virtualLineHeight / 3));
  if (logicalHeight <= realHeight) return centeredLine * virtualLineHeight;
  return (centeredLine / Math.max(1, lineCount)) * realHeight;
}

function tooltipHtml(info: ReturnType<typeof buildHoverInfo>, rawValue?: string): string {
  const argLabel = typeof info.argumentIndex === "number" ? `Argument ${info.argumentIndex + 1}` : "Entity";
  const title = info.attributeName ?? `${info.id} ${info.className}`;
  const lines = [`<strong>${escapeHtml(title)}</strong>`];
  if (!info.attributeName) lines.push(`<span>${argLabel}</span>`);
  if (rawValue && rawValue.startsWith("#")) lines.push(`<code>${escapeHtml(rawValue)}</code>`);
  if (info.target) {
    const targetName = info.target.name ? ` - ${escapeHtml(info.target.name)}` : "";
    lines.push(`<span>Target: ${escapeHtml(info.target.id)} ${escapeHtml(info.target.className)}${targetName}</span>`);
  }
  return lines.join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
