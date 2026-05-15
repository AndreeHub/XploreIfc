import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Braces, Database, FileCode2, Play, RotateCcw, Save, Search, X } from "lucide-react";
import { IfcEditor } from "./components/IfcEditor";
import { ResultsPane } from "./components/ResultsPane";
import { RightSidebar } from "./components/RightSidebar";
import { buildClassSuggestions, buildFilteredText, createFilterChip, filterEntities } from "./lib/filtering";
import { hydrateIfcEntity, parseIfcText } from "./lib/ifcParser";
import { createWorkerIfcTextSource } from "./lib/ifcTextSource";
import { classNameLookup } from "./lib/classNames";
import { sampleIfc } from "./lib/sampleIfc";
import type { ChainStep, FilterChip, IfcEntity, IfcIndex, IfcTextSource, ReferenceClick, SavedQuery } from "./types/ifc";
import "./styles.css";

const emptyIndex: IfcIndex = {
  schema: "UNKNOWN",
  byId: {},
  byClass: {},
  outgoing: {},
  incoming: {},
  classCounts: {},
  orderedIds: [],
  parseErrors: [],
  lineCount: 0,
  lineStarts: []
};

const largeTextThreshold = 25 * 1024 * 1024;

type WorkerMessage =
  | { type: "query"; entities: IfcEntity[]; total: number; truncated: boolean; text: string }
  | { type: "inverse"; key: string; entities: IfcEntity[]; total: number; truncated: boolean }
  | { type: "progress"; loadedBytes: number; totalBytes: number }
  | { type: "error"; message: string }
  | {
      type: "ready";
      large: true;
      summary: {
        schema: IfcIndex["schema"];
        classCounts: Record<string, number>;
        totalEntities: number;
        lineCount: number;
          parseErrors: string[];
      };
    }
  | { type: "ready"; large: false; index: IfcIndex };

export default function App() {
  const [sourceText, setSourceText] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [fileSizeBytes, setFileSizeBytes] = useState(0);
  const [fullIndex, setFullIndex] = useState<IfcIndex>(emptyIndex);
  const [totalEntities, setTotalEntities] = useState(0);
  const [largeMode, setLargeMode] = useState(false);
  const [largeSource, setLargeSource] = useState<IfcTextSource | null>(null);
  const [largeQueryText, setLargeQueryText] = useState("");
  const [largeQueryEntities, setLargeQueryEntities] = useState<IfcEntity[]>([]);
  const [largeQueryTotal, setLargeQueryTotal] = useState(0);
  const [largeInverseEntities, setLargeInverseEntities] = useState<IfcEntity[]>([]);
  const [largeInverseTotal, setLargeInverseTotal] = useState(0);
  const [largeSelectedEntity, setLargeSelectedEntity] = useState<IfcEntity>();
  const [parsing, setParsing] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [inverseQuerying, setInverseQuerying] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [filters, setFilters] = useState<FilterChip[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [trail, setTrail] = useState<ChainStep[]>([]);
  const [queryText, setQueryText] = useState("");
  const [inverseEnabled, setInverseEnabled] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => readSavedQueries());
  const workerRef = useRef<Worker | null>(null);
  const inverseKeyRef = useRef("");

  useEffect(() => {
    workerRef.current = new Worker(new URL("./workers/ifcParser.worker.ts", import.meta.url), { type: "module" });
    workerRef.current.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if ((event.data as WorkerMessage & { requestId?: number }).requestId) return;
      if (event.data.type === "progress") {
        setParseProgress(event.data.totalBytes ? event.data.loadedBytes / event.data.totalBytes : 0);
        return;
      }
      if (event.data.type === "error") {
        setParsing(false);
        setQuerying(false);
        return;
      }
      if (event.data.type === "query") {
        setLargeQueryEntities(event.data.entities);
        setLargeQueryText(event.data.text);
        setLargeQueryTotal(event.data.total);
        setQuerying(false);
        return;
      }
      if (event.data.type === "inverse") {
        if (event.data.key !== inverseKeyRef.current) return;
        setLargeInverseEntities(event.data.entities);
        setLargeInverseTotal(event.data.total);
        setInverseQuerying(false);
        return;
      }

      if (event.data.large) {
        const worker = workerRef.current;
        setLargeMode(true);
        setTotalEntities(event.data.summary.totalEntities);
        setLargeSource(worker ? createWorkerIfcTextSource(worker, event.data.summary.lineCount) : null);
        setFullIndex({
          ...emptyIndex,
          schema: event.data.summary.schema,
          classCounts: event.data.summary.classCounts,
          parseErrors: event.data.summary.parseErrors,
          lineCount: event.data.summary.lineCount,
          lineStarts: []
        });
        setParseProgress(1);
        setParsing(false);
        return;
      }

      setLargeMode(false);
      setLargeSource(null);
      setTotalEntities(event.data.index.orderedIds.length);
      setFullIndex(event.data.index);
      setParseProgress(1);
      setParsing(false);
      const firstId = event.data.index.orderedIds[0];
      setSelectedId((current) => current ?? firstId);
    };
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    return () => largeSource?.dispose();
  }, [largeSource]);

  useEffect(() => {
    if (!sourceText) {
      if (largeMode || parsing) return;
      setFullIndex(emptyIndex);
      setTotalEntities(0);
      setLargeMode(false);
      setLargeSource(null);
      setLargeQueryText("");
      setLargeQueryEntities([]);
      setLargeQueryTotal(0);
      setLargeInverseEntities([]);
      setLargeInverseTotal(0);
      setLargeSelectedEntity(undefined);
      setSelectedId(undefined);
      setParsing(false);
      setQuerying(false);
      setInverseQuerying(false);
      setParseProgress(0);
      return;
    }
    if (largeMode) return;
    setParsing(true);
    setParseProgress(0);
    workerRef.current?.postMessage({ type: "parse", text: sourceText });
  }, [largeMode, sourceText]);

  useEffect(() => {
    if (!largeMode || parsing || !largeSource) return;
    if (filters.length === 0) {
      setLargeQueryText("");
      setLargeQueryEntities([]);
      setLargeQueryTotal(0);
      setLargeInverseEntities([]);
      setLargeInverseTotal(0);
      setQuerying(false);
      return;
    }
    setQuerying(true);
    workerRef.current?.postMessage({ type: "query", filters });
  }, [filters, largeMode, largeSource, parsing]);

  useEffect(() => {
    window.localStorage.setItem("xploreifc:savedQueries", JSON.stringify(savedQueries));
  }, [savedQueries]);

  const filteredEntities = useMemo(() => {
    if (largeMode) return largeQueryEntities;
    return filters.length ? filterEntities(fullIndex, filters, sourceText) : [];
  }, [filters, fullIndex, largeMode, largeQueryEntities, sourceText]);

  const displayText = useMemo(() => {
    if (largeMode) return filters.length > 0 ? largeQueryText : "";
    if (!sourceText) return "";
    if (filters.length === 0) return sourceText;
    return buildFilteredText(filteredEntities, sourceText);
  }, [filteredEntities, filters.length, largeMode, largeQueryText, sourceText]);

  const displayIndex = useMemo(() => {
    if (!displayText) return emptyIndex;
    if (!largeMode && filters.length === 0) return fullIndex;
    return parseIfcText(displayText, { classNameLookup });
  }, [displayText, filters.length, fullIndex, largeMode]);

  useEffect(() => {
    if (!largeMode || !largeSource || !selectedId) {
      setLargeSelectedEntity(undefined);
      return undefined;
    }

    const localEntity = displayIndex.byId[selectedId];
    if (localEntity) {
      setLargeSelectedEntity(hydrateIfcEntity(displayText, localEntity));
      return undefined;
    }

    let cancelled = false;
    largeSource
      .getEntityById(selectedId)
      .then((entity) => {
        if (!cancelled) setLargeSelectedEntity(entity ?? undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [displayIndex.byId, displayText, largeMode, largeSource, selectedId]);

  const selectedEntity = useMemo(() => {
    if (largeMode) return largeSelectedEntity;
    const entity = selectedId ? fullIndex.byId[selectedId] ?? displayIndex.byId[selectedId] : undefined;
    return entity ? hydrateIfcEntity(sourceText, entity) : undefined;
  }, [displayIndex.byId, fullIndex.byId, largeMode, largeSelectedEntity, selectedId, sourceText]);

  const inverseSeedIds = useMemo(
    () =>
      unique([
        ...filters.filter((filter) => filter.type === "id").map((filter) => filter.value),
        ...(selectedEntity ? [selectedEntity.id] : [])
      ]),
    [filters, selectedEntity]
  );

  useEffect(() => {
    if (!largeMode || !largeSource || parsing || !inverseEnabled || inverseSeedIds.length === 0) {
      inverseKeyRef.current = "";
      setLargeInverseEntities([]);
      setLargeInverseTotal(0);
      setInverseQuerying(false);
      return;
    }

    const key = inverseSeedIds.join(",");
    inverseKeyRef.current = key;
    setInverseQuerying(true);
    workerRef.current?.postMessage({ type: "inverse", ids: inverseSeedIds, key });
  }, [inverseEnabled, inverseSeedIds, largeMode, largeSource, parsing]);

  const inverseEntities = useMemo(() => {
    if (largeMode) return largeInverseEntities;
    return unique(inverseSeedIds.flatMap((id) => fullIndex.incoming[id] ?? []))
      .map((id) => fullIndex.byId[id])
      .filter((entity): entity is IfcEntity => Boolean(entity));
  }, [fullIndex, inverseSeedIds, largeInverseEntities, largeMode]);

  const inverseLabel = useMemo(() => {
    return inverseSeedIds.length ? inverseSeedIds.join(", ") : "selection";
  }, [inverseSeedIds]);
  const inverseCount = largeMode ? largeInverseTotal : inverseEntities.length;

  const querySuggestions = useMemo(() => {
    const activeToken = queryText.split(",").at(-1) ?? queryText;
    return buildClassSuggestions(activeToken, fullIndex, 8);
  }, [fullIndex, queryText]);

  const openFile = useCallback((file: File) => {
    if (file.size > largeTextThreshold) {
      setParsing(true);
      setParseProgress(0);
      setLargeMode(true);
      setLargeSource(null);
      setSourceText("");
      setFullIndex(emptyIndex);
      setTotalEntities(0);
      setFileName(file.name);
      setFileSizeBytes(file.size);
      setFilters([]);
      setTrail([]);
      setQueryText("");
      setLargeQueryText("");
      setLargeQueryEntities([]);
      setLargeQueryTotal(0);
      setLargeSelectedEntity(undefined);
      setSelectedId(undefined);
      workerRef.current?.postMessage({ type: "parseFile", file });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setParsing(true);
      setParseProgress(0);
      setLargeMode(false);
      setLargeSource(null);
      setSourceText(String(reader.result ?? ""));
      setFileName(file.name);
      setFileSizeBytes(file.size);
      setFilters([]);
      setTrail([]);
      setQueryText("");
      setLargeQueryText("");
      setLargeQueryEntities([]);
      setLargeQueryTotal(0);
      setLargeSelectedEntity(undefined);
      setSelectedId(undefined);
    };
    reader.readAsText(file);
  }, []);

  const loadSample = useCallback(() => {
    setParsing(true);
    setParseProgress(0);
    setLargeMode(false);
    setLargeSource(null);
    setSourceText(sampleIfc);
    setFileName("sample.ifc");
    setFileSizeBytes(new Blob([sampleIfc]).size);
    setFilters([]);
    setTrail([]);
    setQueryText("");
    setLargeQueryText("");
    setLargeQueryEntities([]);
    setLargeQueryTotal(0);
    setLargeSelectedEntity(undefined);
    setSelectedId(undefined);
  }, []);

  const addFilterFromValue = useCallback((value: string) => {
    setFilters((current) => {
      const chip = createFilterChip(value, current);
      return chip ? [...current, chip] : current;
    });
    setTrail([]);
  }, []);

  const addQueryText = useCallback(
    (value = queryText) => {
      const parts = value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length === 0) return;

      setFilters((current) => {
        const next = [...current];
        parts.forEach((part) => {
          const chip = createFilterChip(part, next);
          if (chip) next.push(chip);
        });
        return next;
      });
      setTrail([]);
      setQueryText("");
    },
    [queryText]
  );

  const resetView = useCallback(() => {
    setFilters([]);
    setTrail([]);
    setQueryText("");
    setLargeQueryText("");
    setLargeQueryEntities([]);
    setLargeQueryTotal(0);
    setLargeSelectedEntity(undefined);
    setSelectedId(fullIndex.orderedIds[0]);
  }, [fullIndex.orderedIds]);

  const saveCurrentQuery = useCallback(() => {
    const queryFilters =
      filters.length > 0
        ? filters
        : queryText
            .split(",")
            .map((part) => createFilterChip(part))
            .filter((chip): chip is FilterChip => Boolean(chip));
    if (queryFilters.length === 0) return;

    const name = queryFilters.map((filter) => filter.label).join(", ");
    const savedQuery: SavedQuery = {
      id: `${Date.now()}-${name}`,
      name,
      filters: queryFilters
    };
    setSavedQueries((current) => [savedQuery, ...current.filter((query) => query.name !== name)].slice(0, 30));
  }, [filters, queryText]);

  const runSavedQuery = useCallback((query: SavedQuery) => {
    setFilters(query.filters);
    setTrail([]);
    setQueryText("");
  }, []);

  const deleteSavedQuery = useCallback((id: string) => {
    setSavedQueries((current) => current.filter((query) => query.id !== id));
  }, []);

  const handleReferenceClick = useCallback(
    async (click: ReferenceClick) => {
      const immediateTarget = fullIndex.byId[click.refId] ?? displayIndex.byId[click.refId];
      setSelectedId(click.refId);
      setFilters((current) => {
        const chip = createFilterChip(click.refId, current);
        return chip ? [...current, chip] : current;
      });
      let target = immediateTarget;
      if (!target && largeSource) {
        try {
          target = (await largeSource.getEntityById(click.refId)) ?? undefined;
        } catch {
          target = undefined;
        }
      }
      if (!target) return;
      setTrail((current) => {
        const step: ChainStep = {
          id: click.refId,
          className: target.className,
          sourceId: click.sourceId,
          argumentIndex: click.argumentIndex,
          attributeName: click.attributeName
        };
        return current.some((item) => item.id === step.id) ? current : [...current, step];
      });
    },
    [displayIndex.byId, fullIndex.byId, largeSource]
  );

  const totalCount = totalEntities || fullIndex.orderedIds.length;
  const visibleCount = largeMode
    ? filters.length
      ? largeQueryTotal || displayIndex.orderedIds.length
      : totalCount
    : displayIndex.orderedIds.length;
  const lineCount = fullIndex.lineCount;
  const fileSize = formatBytes(fileSizeBytes);
  const canShowEditor = largeMode ? Boolean(largeSource) && !querying && !parsing : Boolean(sourceText) && !querying && !parsing;
  const emptyTitle = querying
    ? "Searching IFC index..."
    : parsing
      ? largeMode
        ? `Indexing IFC file... ${Math.round(parseProgress * 100)}%`
        : "Parsing IFC index..."
      : "Open an IFC file to start exploring.";
  const emptyDescription = fileName
    ? "Huge files stay worker-backed; the viewer asks for only the visible line range."
    : "Files stay in this browser session; parsing runs locally in a worker.";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <FileCode2 size={17} />
          <h1>XploreIFC</h1>
        </div>
        <div className="header-actions">
          {fileName ? (
            <span className="file-meta">
              {fileName} - {fileSize} - {lineCount.toLocaleString()} lines
            </span>
          ) : null}
          <button type="button" onClick={loadSample}>
            <Play size={15} />
            <span>Demo</span>
          </button>
          <button type="button" onClick={resetView}>
            <RotateCcw size={15} />
            <span>Reset</span>
          </button>
        </div>
      </header>

      <div className="filter-line">
        <span>Filter lines:</span>
        <div className="query-wrap">
            <Search size={15} />
          <div className="top-filter-chips">
            {filters.map((chip) => (
              <button key={chip.id} type="button" className={`top-chip top-chip-${chip.type}`} onClick={() => setFilters((current) => current.filter((item) => item.id !== chip.id))}>
                <span>{chip.label}</span>
                <X size={12} />
              </button>
            ))}
          </div>
          <input
            id="filter-input"
            aria-label="Filter"
            value={queryText}
            placeholder={filters.length ? "Add..." : "e.g. #123, IFCPROJECT, GlobalId (separate multiple values with a comma)"}
            onChange={(event) => setQueryText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addQueryText();
            }}
          />
          <button type="button" onClick={() => addQueryText()}>
            Search
          </button>
          <button type="button" onClick={saveCurrentQuery} title="Save query">
            <Save size={14} />
          </button>
        </div>
        {queryText.trim() ? (
          <div className="query-suggestions">
            {querySuggestions.map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => addQueryText(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <main className="workspace">
        <section className="viewer-pane">
          <div className="viewer-toolbar">
            <div>
              <strong>{fullIndex.schema}</strong>
              <span>{visibleCount} / {totalCount} entities</span>
            </div>
            <div>
              <span>
                {querying
                  ? "Querying..."
                  : filters.length
                    ? `${largeMode ? largeQueryTotal || filteredEntities.length : filteredEntities.length} hits`
                    : "Full file"}
              </span>
              {fullIndex.parseErrors.length ? <span>{fullIndex.parseErrors.length} parse notes</span> : null}
            </div>
          </div>

          <div className="viewer-split">
            {canShowEditor ? (
              <IfcEditor
                text={displayText}
                source={largeMode && filters.length === 0 ? largeSource : null}
                index={displayIndex}
                fullIndex={fullIndex}
                selectedId={selectedId}
                onSelectEntity={setSelectedId}
                onReferenceClick={handleReferenceClick}
              />
            ) : (
              <div className="empty-state">
                <Database size={42} />
                <h2>{emptyTitle}</h2>
                <p>{emptyDescription}</p>
                {!fileName ? (
                  <button type="button" onClick={loadSample}>
                    <Braces size={16} />
                    <span>Load demo IFC</span>
                  </button>
                ) : null}
              </div>
            )}

            <ResultsPane
              filteredEntities={filteredEntities}
              sourceText={sourceText}
              inverseEntities={inverseEntities}
              inverseEnabled={inverseEnabled}
              inverseLabel={inverseLabel}
              inverseTotal={inverseCount}
              inverseQuerying={inverseQuerying}
              hasQuery={filters.length > 0}
              onSelectEntity={setSelectedId}
            />
          </div>
        </section>

        <RightSidebar
          fileName={fileName}
          index={fullIndex}
          filters={filters}
          parsing={parsing}
          selected={selectedEntity}
          trail={trail}
          savedQueries={savedQueries}
          inverseEnabled={inverseEnabled}
          inverseCount={inverseCount}
          inverseQuerying={inverseQuerying}
          onFile={openFile}
          onAddFilterValue={addFilterFromValue}
          onRemoveFilter={(id) => setFilters((current) => current.filter((chip) => chip.id !== id))}
          onReset={resetView}
          onSaveQuery={saveCurrentQuery}
          onRunSavedQuery={runSavedQuery}
          onDeleteSavedQuery={deleteSavedQuery}
          onInverseEnabledChange={setInverseEnabled}
          onClearTrail={() => setTrail([])}
          onReferenceClick={handleReferenceClick}
          onSelectEntity={setSelectedId}
        />
      </main>
    </div>
  );
}

function readSavedQueries(): SavedQuery[] {
  try {
    return JSON.parse(window.localStorage.getItem("xploreifc:savedQueries") ?? "[]") as SavedQuery[];
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
