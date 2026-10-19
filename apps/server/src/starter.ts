/** Escapes text so it renders literally in a LaTeX text-mode argument. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\{}#$%&_^~]/g, (c) => {
    switch (c) {
      case "\\":
        return "\\textbackslash{}";
      case "^":
        return "\\textasciicircum{}";
      case "~":
        return "\\textasciitilde{}";
      default:
        return `\\${c}`;
    }
  });
}

export const STARTER_MAIN = "main.tex";

export function starterMainTex(projectName: string): string {
  return `\\documentclass{article}

\\title{${escapeLatex(projectName)}}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Start writing here.

\\end{document}
`;
}
