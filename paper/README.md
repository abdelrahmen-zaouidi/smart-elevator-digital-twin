# Journal Article Draft

This directory contains a submission-oriented IEEEtran draft condensed from the master's thesis and repository evidence.

## Files

- `main.tex` - main journal-article draft.
- `references.bib` - BibTeX-compatible references seeded from the thesis bibliography.
- `figures/README.md` - figure plan and source mapping.
- `GAPS.md` - required measurements, metadata tasks, figure tasks, and author-input checklist.

## Compile

From this directory:

```powershell
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

The draft uses `IEEEtran` with BibTeX so it can be switched later to another journal template such as Elsevier `elsarticle`.

## Compile Check

The source compiles cleanly with MiKTeX `pdflatex` + `bibtex`: **0 errors, 0
undefined references, 0 undefined citations, 0 font warnings** (12 pages). The
only remaining `pdflatex` box messages are underfull/overfull `\hbox` warnings
confined to the fixed-width TikZ figure nodes and the justified full-width
tables (11 overfull, mostly a few pt; 74 underfull); they are cosmetic and do
not affect layout correctness. Fonts are set with `\usepackage[T1]{fontenc}` +
`lmodern` + `microtype`, which renders code identifiers (underscores, braces)
and accents ("Médéa", "Systèmes") correctly; `cite`/`booktabs` have
`\IfFileExists` fallbacks and `pgfplots`/`tikz` are used for the figures. The
source stays portable so a later switch to another journal template is
low-effort.

## Current Draft Status

- Claims are evidence-bound to the thesis and repository artifacts read during drafting.
- The validation section distinguishes software PASS, documented hardware integration, prototype timing, and missing instrumentation.
- No fabricated experimental numbers were added.
- Missing quantitative metrics are marked with `[MEASURE: ...]` placeholders and detailed in `GAPS.md`.
- No new unverified citations were added beyond the thesis-seeded bibliography.

### Revision v2 (reviewer response)

Applied in response to a reviewer's seven points, without introducing new data
or citations:

- **Title/abstract recadrés** to match the evidence: title now reads
  "Safety-Gated Digital Twin Architecture for Smart-Elevator Supervision: A
  Software-Validated Laboratory Prototype"; the abstract answers problem →
  solution → what is validated → open limits.
- **"Agentic" removed** everywhere (title, keywords, sections, tables, figures);
  replaced by bounded workflow automation / advisory AI without command
  authority. `grep -i agentic main.tex` is empty.
- **Contributions reduced from 5 to 3** (reproducible architecture; command-
  authority discipline; quantitative low-cost validation), kept consistent
  across title, abstract, and conclusion.
- **Validation framed at three explicit levels** (software / integration /
  documented hardware); the nine-command live run is stated as an
  integration-level functional demonstration, not a statistical sample, with a
  larger campaign listed as future work.
- **Tables reduced from 10 to 8**: the threat-model and future-hardening tables
  were merged into one consolidated "limitations, threats, and hardening" table,
  and the dispatch-policies table was folded into prose. Interpretation
  sentences were added after the gap, validation-summary, metrics, and
  consolidated tables.
- **Results discussed** with an explicit proves / matters / links-to-literature
  treatment for the cost-of-safety and reject-with-zero-write results (runtime
  assurance: Simplex, shielding, supervisory control).
- **Style neutralized** (removed "essentially nothing", "essentially free",
  "without hesitation", "unusually explicit"); floor detection reframed as
  functional open-loop step counting, with KY-024/SPDT as future closed-loop
  confirmation.
