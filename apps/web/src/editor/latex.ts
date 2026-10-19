import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";

/** LaTeX syntax highlighting (CodeMirror's sTeX mode). */
export const latexLanguage = StreamLanguage.define(stex);

const commands = [
  "documentclass",
  "usepackage",
  "title",
  "author",
  "date",
  "maketitle",
  "tableofcontents",
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "textbf",
  "textit",
  "texttt",
  "emph",
  "underline",
  "footnote",
  "label",
  "ref",
  "eqref",
  "pageref",
  "cite",
  "citep",
  "citet",
  "url",
  "href",
  "includegraphics",
  "caption",
  "centering",
  "item",
  "newpage",
  "clearpage",
  "input",
  "include",
  "bibliography",
  "bibliographystyle",
  "printbibliography",
  "addbibresource",
  "newcommand",
  "renewcommand",
  "frac",
  "sqrt",
  "sum",
  "int",
  "prod",
  "lim",
  "infty",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "lambda",
  "mu",
  "pi",
  "sigma",
  "omega",
  "left",
  "right",
  "mathbb",
  "mathcal",
  "mathrm",
  "text",
  "hline",
  "vspace",
  "hspace",
  "today",
];

const withArgument = new Set([
  "documentclass",
  "usepackage",
  "title",
  "author",
  "date",
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "textbf",
  "textit",
  "texttt",
  "emph",
  "underline",
  "footnote",
  "label",
  "ref",
  "eqref",
  "pageref",
  "cite",
  "citep",
  "citet",
  "url",
  "includegraphics",
  "caption",
  "input",
  "include",
  "bibliography",
  "bibliographystyle",
  "addbibresource",
  "mathbb",
  "mathcal",
  "mathrm",
  "text",
  "vspace",
  "hspace",
  "sqrt",
]);

const environments = [
  "document",
  "abstract",
  "itemize",
  "enumerate",
  "description",
  "figure",
  "table",
  "tabular",
  "equation",
  "equation*",
  "align",
  "align*",
  "center",
  "quote",
  "verbatim",
  "theorem",
  "proof",
];

const options: Completion[] = [
  ...commands.map((name) =>
    withArgument.has(name)
      ? snippetCompletion(`\\${name}{#{}}`, {
          label: `\\${name}`,
          type: "function",
        })
      : name === "frac"
        ? snippetCompletion("\\frac{#{num}}{#{den}}", {
            label: "\\frac",
            type: "function",
          })
        : { label: `\\${name}`, type: "keyword" },
  ),
  ...environments.map((env) =>
    snippetCompletion(`\\begin{${env}}\n\t#{}\n\\end{${env}}`, {
      label: `\\begin{${env}}`,
      type: "class",
    }),
  ),
];

/** Completes common commands and environments after a backslash. */
export function latexCompletions(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/\\[a-zA-Z]*\*?/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options, validFor: /^\\[a-zA-Z]*\*?$/ };
}
