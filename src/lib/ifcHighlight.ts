import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

type Token = {
  from: number;
  to: number;
  className: string;
};

const marks = {
  entityId: Decoration.mark({ class: "cm-ifc-entity-id" }),
  className: Decoration.mark({ class: "cm-ifc-class" }),
  reference: Decoration.mark({ class: "cm-ifc-reference" }),
  string: Decoration.mark({ class: "cm-ifc-string" }),
  enum: Decoration.mark({ class: "cm-ifc-enum" }),
  number: Decoration.mark({ class: "cm-ifc-number" }),
  placeholder: Decoration.mark({ class: "cm-ifc-placeholder" }),
  section: Decoration.mark({ class: "cm-ifc-section" })
};

export function ifcHighlightExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations
    }
  );
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tokens: Token[] = [];

  for (const range of view.visibleRanges) {
    const text = view.state.doc.sliceString(range.from, range.to);
    collectTokens(text, range.from, tokens);
  }

  tokens
    .filter((token) => token.to > token.from)
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .reduce((lastEnd, token) => {
      if (token.from < lastEnd) return lastEnd;
      const mark = marks[token.className as keyof typeof marks];
      if (mark) builder.add(token.from, token.to, mark);
      return token.to;
    }, -1);

  return builder.finish();
}

function collectTokens(text: string, offset: number, tokens: Token[]) {
  collect(text, offset, /#\d+(?=\s*=)/g, "entityId", tokens);
  collectClassNames(text, offset, tokens);
  collect(text, offset, /\b(?:ISO-10303-21|HEADER|DATA|ENDSEC|END-ISO-10303-21)\b/g, "section", tokens);
  collect(text, offset, /'([^']|'')*'/g, "string", tokens);
  collect(text, offset, /#\d+/g, "reference", tokens);
  collect(text, offset, /\.[A-Z0-9_]+\./g, "enum", tokens);
  collect(text, offset, /[$*]/g, "placeholder", tokens);
  collect(text, offset, /(?:^|[,(=\s])([-+]?(?:\d+\.\d*|\d+|\.\d+)(?:[Ee][-+]?\d+)?)/g, "number", tokens, 1);
}

function collect(text: string, offset: number, pattern: RegExp, className: string, tokens: Token[], group = 0) {
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const value = match[group];
    if (!value) continue;
    const groupOffset = group === 0 ? 0 : match[0].indexOf(value);
    const from = offset + match.index + groupOffset;
    tokens.push({ from, to: from + value.length, className });
  }
}

function collectClassNames(text: string, offset: number, tokens: Token[]) {
  for (const match of text.matchAll(/=\s*([A-Z][A-Z0-9_]*)\s*\(/g)) {
    if (match.index === undefined || !match[1]) continue;
    const from = offset + match.index + match[0].indexOf(match[1]);
    tokens.push({ from, to: from + match[1].length, className: "className" });
  }
}
