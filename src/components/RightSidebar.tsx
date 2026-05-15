import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileUp, ListTree, Save, X } from "lucide-react";
import type { ChainStep, FilterChip, IfcEntity, IfcIndex, ReferenceClick, SavedQuery } from "../types/ifc";
import { entitySchema, summarizeEntity } from "../lib/schema";

interface RightSidebarProps {
  fileName?: string;
  index: IfcIndex;
  filters: FilterChip[];
  parsing: boolean;
  selected?: IfcEntity;
  trail: ChainStep[];
  savedQueries: SavedQuery[];
  inverseEnabled: boolean;
  inverseCount: number;
  inverseQuerying: boolean;
  onFile: (file: File) => void;
  onAddFilterValue: (value: string) => void;
  onRemoveFilter: (id: string) => void;
  onReset: () => void;
  onSaveQuery: () => void;
  onRunSavedQuery: (query: SavedQuery) => void;
  onDeleteSavedQuery: (id: string) => void;
  onInverseEnabledChange: (enabled: boolean) => void;
  onClearTrail: () => void;
  onReferenceClick: (click: ReferenceClick) => void;
  onSelectEntity: (id: string) => void;
}

export function RightSidebar({
  fileName,
  index,
  filters,
  parsing,
  selected,
  trail,
  savedQueries,
  inverseEnabled,
  inverseCount,
  inverseQuerying,
  onFile,
  onAddFilterValue,
  onRemoveFilter,
  onReset,
  onSaveQuery,
  onRunSavedQuery,
  onDeleteSavedQuery,
  onInverseEnabledChange,
  onClearTrail,
  onReferenceClick,
  onSelectEntity
}: RightSidebarProps) {
  const outgoing = selected ? (selected.refs.length ? selected.refs : index.outgoing[selected.id] ?? []) : [];
  const schemaEntity = selected ? entitySchema(index.schema, selected.className) : undefined;

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = "";
  }

  return (
    <aside className="right-sidebar">
      <div className="side-top">
        <label className="small-file-button">
          <FileUp size={15} />
          <span>Open</span>
          <input aria-label="Open IFC file" type="file" accept=".ifc,.ifczip,.txt" onChange={handleFile} />
        </label>
        <div className="side-file" title={fileName}>
          {fileName ?? "No file"}
        </div>
        {parsing ? <span className="mini-status">Parsing</span> : null}
      </div>

      <Collapsible title="Query" defaultOpen>
        <div className="compact-actions">
          <button type="button" onClick={onSaveQuery} disabled={filters.length === 0}>
            <Save size={13} />
            <span>Save</span>
          </button>
          <button type="button" onClick={onReset}>
            Reset
          </button>
        </div>
        {filters.length === 0 ? <p className="muted">No active query.</p> : null}
        <div className="compact-chip-list">
          {filters.map((chip) => (
            <button key={chip.id} type="button" className={`compact-chip compact-chip-${chip.type}`} onClick={() => onRemoveFilter(chip.id)}>
              <span>{chip.label}</span>
              <X size={12} />
            </button>
          ))}
        </div>
      </Collapsible>

      <Collapsible title={`Saved Queries (${savedQueries.length})`} defaultOpen={savedQueries.length > 0}>
        {savedQueries.length === 0 ? <p className="muted">Saved searches appear here.</p> : null}
        <div className="saved-list">
          {savedQueries.map((query) => (
            <div key={query.id} className="saved-row">
              <button type="button" onClick={() => onRunSavedQuery(query)} title={query.name}>
                {query.name}
              </button>
              <button type="button" aria-label={`Delete ${query.name}`} onClick={() => onDeleteSavedQuery(query.id)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </Collapsible>

      <Collapsible title="Loaded Classes" defaultOpen>
        <div className="class-list">
          {Object.keys(index.classCounts).length === 0 ? <p className="muted">Open a file to see classes.</p> : null}
          {Object.entries(index.classCounts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 80)
            .map(([className, count]) => (
              <button key={className} type="button" onClick={() => onAddFilterValue(className)}>
                <span>{className}</span>
                <strong>{count}</strong>
              </button>
            ))}
        </div>
      </Collapsible>

      <Collapsible title="Selection" defaultOpen>
        {!selected ? <p className="muted">Click an entity or reference.</p> : null}
        {selected ? (
          <div className="mini-inspector">
            <div>
              <strong>{selected.id}</strong>
              <span>{selected.className}</span>
              <small>Line {selected.lineStart}</small>
            </div>
            {summarizeEntity(selected) ? <p>{summarizeEntity(selected)}</p> : null}
            {schemaEntity?.description ? <p className="muted">{schemaEntity.description}</p> : null}
          </div>
        ) : null}
      </Collapsible>

      <Collapsible title={`Outgoing (${outgoing.length})`} defaultOpen={Boolean(selected)}>
        <div className="side-ref-list">
          {outgoing.length === 0 ? <p className="muted">No outgoing references.</p> : null}
          {outgoing.map((refId) => {
            const target = index.byId[refId];
            return (
              <button key={refId} type="button" onClick={() => onReferenceClick({ refId, sourceId: selected?.id })}>
                <span>{refId}</span>
                <small>{target?.className ?? "unresolved"}</small>
              </button>
            );
          })}
        </div>
      </Collapsible>

      <Collapsible title={`Trail (${trail.length})`} defaultOpen={trail.length > 0}>
        <div className="compact-actions">
          <button type="button" onClick={onClearTrail} disabled={trail.length === 0}>
            Clear trail
          </button>
        </div>
        <div className="side-ref-list" data-testid="chain-panel">
          {trail.length === 0 ? <p className="muted">Forward clicks appear here.</p> : null}
          {trail.map((step, indexInTrail) => (
            <button key={`${step.id}-${indexInTrail}`} type="button" onClick={() => onSelectEntity(step.id)}>
              <span>{step.id}</span>
              <small>{step.className}</small>
            </button>
          ))}
        </div>
      </Collapsible>

      <div className="inverse-switch">
        <div>
          <strong>Inverse split</strong>
          <span>{inverseQuerying ? "Searching refs..." : `${inverseCount} incoming refs`}</span>
        </div>
        <button
          type="button"
          className={inverseEnabled ? "switch-on" : ""}
          aria-pressed={inverseEnabled}
          onClick={() => onInverseEnabledChange(!inverseEnabled)}
          data-testid="incoming-toggle"
        >
          <ListTree size={14} />
          <span>{inverseEnabled ? "On" : "Off"}</span>
        </button>
      </div>
    </aside>
  );
}

interface CollapsibleProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function Collapsible({ title, defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <section className="collapse-section">
      <button type="button" className="collapse-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
      </button>
      {open ? <div className="collapse-body">{children}</div> : null}
    </section>
  );
}
