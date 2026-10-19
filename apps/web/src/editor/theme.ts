import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/** Editor chrome using the app's color tokens, so light and dark mode both work. */
export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface)",
    color: "var(--muted)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--accent) 6%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)",
  },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--fg)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    {
      backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)",
    },
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-fg)",
  },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
  ".cm-panels": {
    backgroundColor: "var(--surface)",
    color: "var(--fg)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--ok) 30%, transparent)",
  },
});

/** Syntax colors as CSS variables (defined in index.css for light and dark). */
export const editorHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.tagName, t.keyword], color: "var(--syn-command)" },
    { tag: [t.atom, t.typeName, t.className], color: "var(--syn-env)" },
    { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: [t.number, t.string], color: "var(--syn-literal)" },
    { tag: [t.bracket, t.brace, t.squareBracket], color: "var(--syn-bracket)" },
    { tag: t.variableName, color: "var(--syn-var)" },
    { tag: t.invalid, color: "var(--danger)" },
  ]),
);
