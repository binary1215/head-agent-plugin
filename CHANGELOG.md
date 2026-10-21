# Changelog

[한국어](CHANGELOG.ko.md)

## Publication policy

Intermediate beta versions are distributed through the Codex and Claude
marketplace branches after successful CI and publication checks. A source commit
or version number alone does not prove publication. Git tags and GitHub Releases
are made only for separately designated releases; missing intermediate tags are
not backfilled. Marketplace publication does not prove local installation or
Host/MCP reload.

## 0.3.0-beta.55 — candidate, publication not yet verified

- Preserve selected graph context during search while retaining explicit scope.
- Explain verified copied/pending Project locations without adopting them in status.
- Omit generated local metadata with `graph-explorer --share`; retain original
  evidence and disclose exact HTML size without a size gate.
- Correct relocation/CLI guidance, human-facing Lode labels and missing-source
  explanations. These changes do not add a new MCP tool or recovery authority.

## 0.3.0-beta.54 — published

Source: `d0c12fe20ad0759efedb096542ecd7ccf47af2a3`.
CI [39562855184](https://github.com/binary1215/lode/actions/runs/39562855184)
succeeded; Lode and compatibility Codex/Claude marketplace branches were verified.
Preserved immediate Session-loss diagnostics and aligned the explicit-relocation
regression fixture with supported resume behavior.

## 0.3.0-beta.53 — not published

Source: `22d471e18e0ebbe82b8ea07612cc749598ae20c4`.
Added scalable graph navigation, exact context detail and explicit Project-folder
relocation. CI failed two regression tests; marketplace publishers were skipped.
The corrected successor is beta.54, not a replacement of this source history.

## 0.3.0-beta.52

Source: `4883322`. Retained recorded context provenance in shared graph views.

## 0.3.0-beta.51 — not published

Source: `465120c`. Aligned graph presentation and scan signatures. CI failed;
do not interpret this version as a successfully published marketplace release.

## 0.3.0-beta.50 / beta.49

Sources: `3327dfc` / `a2a9b08`. Added compute-output retries up to 512 MiB and
raised the default compute-output budget to 64 MiB, respectively. These entries
describe source changes, not an independent assertion of publication status.
