# Asset contract v1

The package at the repository root is the shared producer/consumer implementation. Pin it by exact Git commit in Neurocenter. Never maintain a second envelope schema in the app.

## Repository and pinning

`index.json` is `{schemaVersion:1, assets:[{id,kind,version,path,sha256,current}]}`. IDs are stable lowercase identifiers. An index retains multiple immutable versions per ID and marks exactly one with `current:true`; historical entries explicitly set `current:false`. A descriptor path is `assets/<id>/<version>/asset.json`.

The app pins the repository, a full Git commit and index SHA before reading. Every index `sha256` hashes the descriptor's **exact UTF-8 bytes, including a trailing newline**. `dependency.sha256` has this same meaning. `assetDigest(bytes)` never accepts a parsed object. Producers use `serializeAsset(asset)` for deterministic sorted JSON plus one newline; readers verify the received bytes before parsing.

## Envelope

```json
{
  "schemaVersion": 1,
  "id": "mcp-filesystem",
  "kind": "mcp",
  "version": "1.0.0",
  "source": {"type":"npm","name":"@modelcontextprotocol/server-filesystem","version":"1.0.0"},
  "license": {"spdx":"NOASSERTION"},
  "compatibility": {"packageFormat":5},
  "card": {},
  "delivery": {"type":"runtime-artifacts","artifacts":[]}
}
```

This is an abbreviated envelope, not a complete installable example. Checked real descriptors are in `assets/`. Unknown fields, schema versions, package formats and bridge protocols are rejected. The envelope version and upstream source revision are separate from the catalog's integer version.

`source` is an exact npm semver, a GitHub repository plus full commit and optional relative path, or a GitHub release tag with artifact byte pins. Mutable `latest`, `main`, `master` and `HEAD` are rejected as versions. Optional npm integrity is SHA-512. GitHub release URLs use public HTTPS without credentials/query/fragment; redirects are restricted to GitHub release CDNs and each payload still must match its SHA and size.

`dependencies` is an optional list of `{id,version,sha256}`. Resolve a complete dependency-first selection before downloading or saving. Explicit IDs choose their current versions; dependencies resolve exact historical tuples without substituting a newer current version. Selecting A→Bv1 together with current Bv2 keeps both B versions distinct. The importer retains snapshots and never silently downgrades the native head; if a required historical native snapshot cannot be retained, preview reports a conflict. Missing dependencies, version/SHA mismatches, duplicate versions and cycles reject the selection.

`assertIndexEvolution(previous,next)` rejects changed bytes/kind under an existing ID/version and disappearance of published historical entries. Moving `current` to a different immutable version is explicit; rewriting an existing version or removing it and later reusing the version is not allowed.

Tool/skill dependencies are portable source pins, not deployment UUIDs. Public card `dependencies` and skill `meta.dependencies` must be absent or empty. Before creating the native publication, the server resolves each source pin to a validated local MCP/plugin ID, integer version and package manifest. Pass `{dependencies:[{id,version,sha256,kind,native:{kind,id,version,manifest}}]}` to `toToolPublication` or `toSkillCreate`. Each mapping must match the exact source tuple. A missing mapping fails; the adapter never silently drops a dependency. Exporting an existing native publication requires the same source mapping context to strip native IDs safely. Repeated plans retain the same reserved native IDs.

Model and bridge source dependencies are supply-only: resolve their closure and persist source edges, immutable byte retention and provenance before publishing. Native model/bridge projections do not turn these edges into runtime installation pins. A tool/skill dependency on a model, skill or bridge cannot be misrepresented as an MCP/plugin native pin; that unsupported runtime mapping fails explicitly. App domain validators still validate native dependency pins and approved install plans.

Optional `recipe:{path,sha256}` pins an internal build recipe within this repository. It is not a form the end user must write. A recipe does not authorize executing arbitrary hooks on a device.

## Native payloads

| Kind | `card` | `delivery` | Consumer boundary |
| --- | --- | --- | --- |
| `mcp`, `plugin` | Native `IAiPluginCreate`, without publicationKey or config.extra.runtimeArtifacts | `{type:'runtime-artifacts',artifacts:[{url,descriptor}]}` using the existing RuntimeArtifact fields | `toToolPublication` generates runtimeArtifacts; app runs validatePublication, native buildPackage and verifyPackage |
| `skill` | Native common `ISkillCreateRequest`, including body, meta and relative resources | `{type:'inline'}` | `toSkillCreate`; app runs validateSkillCreate, renders instruction and builds/verifies its native package |
| `model` | Native `{id,name,descriptor}` model record | `{type:'model-bundle',lock,bundle}` retaining current lock/bundle formats, or `{type:'remote-api'}` | `toModelRecord`; app validates model fields and native model supply or private remote configuration |
| `bridge` | `{name,description,tags?}` | `{type:'bridge-release',release:<native BridgeRuntimeRelease>}` | `toBridgeRelease`; app validates bridge build metadata and uses its infrastructure updater |

Model and bridge formats are not converted into tool runtime TAR descriptors. Bridge target names and probe metadata remain native. A bridge is never published as an MCP server or OpenCode plugin. The model bundle is limited to the exact files of its lock. Files may have pinned split parts; inline manifests are checked against both SHA and lock contents.

Remote models use native `runtime:'remote-openai'|'remote-ollama'`, an explicit provider `model` and `modelVersion`, capability, dimension and source. Public descriptors set `manifestSha256:null` and `verificationSha256:null`: they cannot claim local weights or a deployment-specific verification. Remote endpoint, credentials and actual readiness belong to private server configuration. Importing a remote card does not imply that the provider is configured or inference succeeds.

`compatibility.packageFormat:5` means the consumer supports the current native package family. The native builder chooses its existing package version: inline skill packages can remain format 4; runtime-artifact tool packages use format 5. This envelope does not change installation hashing or protocol rules. Bridges additionally require `compatibility.bridgeProtocol:2`.

Runtime descriptors appear exactly once, in `delivery.artifacts`. The producer rejects disagreement with the builder's initial runtimeArtifacts before removing that duplicate. The consumer generates the native publication list automatically. Neither step accepts a manual alternate list.

## API Gateway delivery

Artifact URLs in this public repository are **server-side supply sources**. `downloadArtifacts` and `fetchArtifact` are server-supply helpers, not device installation APIs. `fetchArtifact` writes a new staging file, checks pinned byte length/SHA, removes partial files on failure and never extracts or executes bytes.

The server verifies archives using its existing inspector, ingests verified immutable files and creates/updates the selected card with provenance in the same catalog transaction. Only then may approved project operations deliver through authorized API Gateway endpoints. Device requests use the configured gateway address; the server checks user/device/project access and reference pins. Tool publication adapters contain descriptors, never upstream artifact URLs. Gateway addresses and credentials depend on an installation and are not written into an immutable public descriptor.

Preview and import must distinguish create/update/unchanged/conflict and preserve existing immutable versions. Re-importing the same ID/version/hash is idempotent. Changing bytes under an existing version is a conflict. Existing provenance/CAS receipts should be extended rather than bypassed with direct SQL.

The main admin controls removing a card and its project references after viewing impact. This does not silently uninstall local files. Referenced immutable bytes must stay protected until existing project versions, approved plans and retention rules release their references.

## Validation levels and migration

`validateAsset` checks the shared envelope and native delivery consistency. App domain validators remain authoritative for publication configuration, secret references, native dependency pins and persistence permissions. `loadRepository` verifies exact descriptor/recipe bytes and safe local paths. `selectAssets` validates closure before side effects. These checks never claim a live MCP handshake or model inference.

The initial native examples point to existing, SHA-pinned releases in `ghost-raven1/neurocenter`. No old binaries are renamed or rehashed. New publications can point to `ghost-raven1/neurocenter-assets` with the same descriptor shape. Consumers must authorize the intended supply repositories; arbitrary upstream release hosts are not automatically trusted because they have a hash.

Startup and schema initialization must not auto-import every available asset. Downloading supply, adding selected cards, assigning cards to projects and installing through a bridge are separate operations. Existing caches, platform inspection, locks, approval manifests and rollback journals remain in use.

The initial contract library does not add new source compilers. Existing source/entrypoint inspection can be reused; unsupported languages, ambiguous entrypoints, missing runtimes and untested platforms must be reported accurately.
