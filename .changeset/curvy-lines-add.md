---
"@ifc-lite/create": patch
---

Use declared cached length units for wall-axis extraction from source-empty
native stores. Preserve metre-space overlay axes in millimetre models and avoid
false empty-buffer unit warnings; unknown units keep the existing warning and
fallback. Source-backed resolution is unchanged.


