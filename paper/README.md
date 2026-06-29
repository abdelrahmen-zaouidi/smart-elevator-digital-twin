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

The source was compiled locally on 2026-06-27 after `IEEEtran.cls` became available in MiKTeX. The generated PDF is `main.pdf` in this directory. The local TeX installation is still minimal: `cite.sty`, `booktabs.sty`, and Times/Courier font support were not fully available, so `main.tex` includes fallbacks for `cite` and `booktabs`, and MiKTeX substituted Computer Modern fonts during compilation. For a final submission build, install the missing MiKTeX packages/fonts and rerun the compile sequence above.

## Current Draft Status

- Claims are evidence-bound to the thesis and repository artifacts read during drafting.
- The validation section distinguishes software PASS, documented hardware integration, prototype timing, and missing instrumentation.
- No fabricated experimental numbers were added.
- Missing quantitative metrics are marked with `[MEASURE: ...]` placeholders and detailed in `GAPS.md`.
- No new unverified citations were added beyond the thesis-seeded bibliography.
