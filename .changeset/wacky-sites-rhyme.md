---
"@ifc-lite/ai": minor
"@ifc-lite/bcf": patch
"@ifc-lite/bcf-api": minor
"@ifc-lite/cache": patch
"@ifc-lite/charts": minor
"@ifc-lite/clash": patch
"@ifc-lite/cli": minor
"@ifc-lite/collab": patch
"@ifc-lite/collab-server": minor
"@ifc-lite/create": major
"create-ifc-lite": patch
"@ifc-lite/diff": patch
"@ifc-lite/documents-api": patch
"@ifc-lite/drawing-2d": minor
"@ifc-lite/embed-protocol": patch
"@ifc-lite/embed-sdk": patch
"@ifc-lite/extensions": minor
"@ifc-lite/flow": minor
"@ifc-lite/flow-nodes": minor
"@ifc-lite/ids": minor
"@ifc-lite/ids-agent": minor
"@ifc-lite/ids-authoring": minor
"@ifc-lite/lens": minor
"@ifc-lite/lists": minor
"@ifc-lite/mcp": minor
"@ifc-lite/merge": patch
"@ifc-lite/oauth-pkce": minor
"@ifc-lite/opencde-foundation": minor
"@ifc-lite/plugin-api": minor
"@ifc-lite/query": patch
"@ifc-lite/rules": minor
"@ifc-lite/sandbox": minor
"@ifc-lite/sdk": minor
"@ifc-lite/semantic": minor
"@ifc-lite/server-bin": patch
"@ifc-lite/server-client": patch
"@ifc-lite/solar": patch
"@ifc-lite/source-autodesk": minor
"@ifc-lite/source-dalux": patch
"@ifc-lite/source-dropbox": minor
"@ifc-lite/source-msgraph": minor
"@ifc-lite/viewer-core": patch
---

Integrate the complete 62-package source set from production 61d209288c1b117d405628ead302d0ee700bd2a0 while preserving the customized native viewer and Rust 20.4 / WASM 10.4 core. Include the six new AI, semantic, IDS authoring/agent, report-contract and Autodesk source libraries with matching guides and generated API surfaces.

Retain fail-closed native BCF publication on Windows with write-capable directory flush handles, and portable CLI filesystem/fixture tests.
