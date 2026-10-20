# Contract reference

The single maintained format reference is [Asset contract v1](../skills/neurocenter-packaging/references/contract.md).

The shared runtime implementation is exported from `@neurocenter/asset-contract`. Types are in [`index.d.ts`](../index.d.ts).

## Verified local content

A local ZIP or canonical source snapshot uses `source: {type: "archive", sha256, bytes}`. Its hash covers the exact snapshot bytes; the envelope contains no server paths, credentials, device IDs, or invented repository URL.

Tool delivery artifacts may omit `url`. Such an artifact remains identified by its native descriptor SHA-256 and byte inventory. An importer may accept it only when those exact bytes already exist in its verified blob store. `downloadArtifacts` retains content-only entries; `fetchArtifact` rejects them before making a request or creating a file. A missing blob never falls back to an unpinned source.

Publishing a local build adds real immutable Release transports and exports a new source version. It preserves native package bytes/pins. Previously published source version bytes remain immutable. Consumers still validate the native package and authorize installation through their API Gateway.
