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
undefined references, 0 overfull/underfull boxes, 0 font warnings** (12 pages).
Fonts are set with `\usepackage[T1]{fontenc}` + `lmodern` + `microtype`, which
renders code identifiers (underscores, braces) and accents ("Médéa",
"Systèmes") correctly; `cite`/`booktabs` have `\IfFileExists` fallbacks and
`pgfplots`/`tikz` are used for the figures. The source stays portable so a later
switch to another journal template is low-effort.

## Current Draft Status

- Claims are evidence-bound to the thesis and repository artifacts read during drafting.
- The validation section distinguishes software PASS, documented hardware integration, prototype timing, and missing instrumentation.
- No fabricated experimental numbers were added.
- Missing quantitative metrics are marked with `[MEASURE: ...]` placeholders and detailed in `GAPS.md`.
- No new unverified citations were added beyond the thesis-seeded bibliography.
