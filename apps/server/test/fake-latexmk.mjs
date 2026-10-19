// A cross-platform stand-in for latexmk in tests. Behaviour depends on markers in the main file:
//   SLEEP     start a grandchild that writes its pid to sleeper.pid and sleeps (tests process-tree kill)
//   BREAK     write a TeX-style error to the log and exit 12
//   NOPDF     exit 0 without producing a PDF
// Otherwise it writes output.pdf and output.log into -outdir. It always records its arguments in the log.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "-v") {
  console.log("Latexmk (fake) Version 0");
  process.exit(0);
}

const outdir =
  args.find((a) => a.startsWith("-outdir="))?.slice("-outdir=".length) ?? ".";
const main = args.at(-1) ?? "";
const source = readFileSync(main, "utf8");
const log = [
  `This is FakeTeX. args: ${JSON.stringify(args)}`,
  `cwd: ${process.cwd()}`,
];
log.push(
  `env: max_print_line=${process.env.max_print_line ?? ""} openout_any=${process.env.openout_any ?? ""}`,
);
const writeLog = () =>
  writeFileSync(join(outdir, "output.log"), `${log.join("\n")}\n`);

/** A minimal valid one-page PDF showing `text`, with a correct cross-reference table. */
function pdf(text) {
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

if (source.includes("SLEEP")) {
  const sleeper = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 600000)"],
    { stdio: "ignore" },
  );
  writeFileSync(join(outdir, "sleeper.pid"), String(sleeper.pid));
  writeLog();
  setTimeout(() => {}, 600000);
} else if (source.includes("BREAK")) {
  log.push(
    `${main}:3: Undefined control sequence.`,
    "l.3 \\foo",
    `${main}:3:  ==> Fatal error occurred, no output PDF file produced!`,
  );
  writeLog();
  process.exit(12);
} else if (source.includes("NOPDF")) {
  writeLog();
  process.exit(0);
} else {
  writeFileSync(join(outdir, "output.pdf"), pdf("Hello from FakeTeX"));
  writeLog();
  process.exit(0);
}
