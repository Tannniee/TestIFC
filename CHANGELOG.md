# Changelog

## 1.0.1 — 2026-09-02

- Set the application, API, frontend fallback and Windows executable metadata to
  version 1.0.1. Desktop JSON logs now include the application version.
- Reduce avoidable fragment-buffer copies during model loading and cache upload.
- Serialize semantic-index workers, cancel superseded work and resume incomplete
  cold indexes from a usable hot index.
- Move cache retention off activation requests and protect model bundles while
  they are uploading or in use.
- Serialize model activation and discard stale measurement results after tool or
  model changes.
- Include model and operation context in structured logs; invalidate semantic
  caches when the extractor version changes.
- Add lifecycle, buffer-transfer and large-model benchmark tooling. Local IFC
  files, generated measurements, caches and executable artifacts are excluded
  from the source release.

Known limitations: dense steel models can still stutter during navigation.
SQLite cold-index writes can temporarily delay hot-index reads; this release
does not claim to fix that contention. Large-model benchmarks were run against
the source application; packaged smoke checks are recorded locally.
