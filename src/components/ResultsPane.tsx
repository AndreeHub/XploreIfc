import type { IfcEntity } from "../types/ifc";
import { entityRaw } from "../lib/filtering";

interface ResultsPaneProps {
  filteredEntities: IfcEntity[];
  sourceText: string;
  inverseEntities: IfcEntity[];
  inverseEnabled: boolean;
  inverseLabel: string;
  hasQuery: boolean;
  onSelectEntity: (id: string) => void;
}

export function ResultsPane({ filteredEntities, sourceText, inverseEntities, inverseEnabled, inverseLabel, hasQuery, onSelectEntity }: ResultsPaneProps) {
  if (!hasQuery && !inverseEnabled) return null;

  return (
    <div className={`results-pane ${hasQuery && inverseEnabled ? "results-two" : ""}`}>
      {hasQuery ? (
        <section className="results-section">
          <div className="results-title">Search results - {filteredEntities.length} hits</div>
          <div className="results-list">
            {filteredEntities.map((entity) => (
              <button key={entity.id} type="button" onClick={() => onSelectEntity(entity.id)}>
                <span>Line {entity.lineStart}</span>
                <code>{entityRaw(entity, sourceText)}</code>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {inverseEnabled ? (
        <section className="results-section" data-testid="incoming-list">
          <div className="results-title">Inverse relationships for {inverseLabel} - {inverseEntities.length} hits</div>
          <div className="results-list">
            {inverseEntities.length === 0 ? <p>No inverse relationships for the selected item.</p> : null}
            {inverseEntities.map((entity) => (
              <button key={entity.id} type="button" onClick={() => onSelectEntity(entity.id)}>
                <span>Line {entity.lineStart}</span>
                <code>{entityRaw(entity, sourceText)}</code>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
