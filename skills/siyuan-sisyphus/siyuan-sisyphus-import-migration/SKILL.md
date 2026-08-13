---
name: siyuan-sisyphus-import-migration
description: CLI-only staged playbook for Markdown and external database migration with explicit targets, mappings, bounded writes, and layered readback.
---

# SiYuan Import and Migration with the CLI

Use this scenario for caller-preprocessed Markdown or external database/template migration. It does not parse arbitrary local files, promise NodeCallout conversion, read exact .sy files, preserve source IDs, decrypt notebooks, or perform browser UI acceptance.

## P0: freeze the contract

Record source descriptor/hash, target notebook/path, scope, conflict policy, business-profile boundary, recoverable safety net, one-writer state, confirmation, and the three acceptance gates before W3 writes.

```bash
siyuan-sisyphus system get-version --json
```
```bash
siyuan-sisyphus notebook list --json
```
```bash
siyuan-sisyphus notebook get-permissions --json
```
```bash
siyuan-sisyphus system conf --mode 'summary' --json
```
```bash
siyuan-sisyphus fs tree --path '<target-workspace-path>' --max-depth '4' --json
```

Stop on an ambiguous target, missing authorization or safety net, multiple writers, unresolved business rules, or a direct .sy/encrypted request. Titles, labels, search hits, and UI positions are discovery hints, never foreign keys.

## P1: validate the external source

The caller or a separately reviewed preprocessor supplies preprocessed Markdown, source hash, transform report, ordered image refs, stable wikilink map, and unresolved diagnostics. It removes YAML frontmatter and normalizes supported image/callout/list syntax without inventing IDs or silently dropping values.

```bash
siyuan-sisyphus fs read --path '<staged-workspace-document>' --block-start '0' --block-limit '50' --token-budget '2000' --include-block-ids --json
```
```bash
siyuan-sisyphus fs search --path '<staged-workspace-root>' --query '<source-keyword>' --page '1' --page-size '20' --json
```
```bash
siyuan-sisyphus file list-templates --query '<template-keyword>' --page '1' --page-size '20' --json
```
```bash
siyuan-sisyphus file read-template --path '<resolved-template-path>' --offset '0' --limit '8000' --json
```

`fs.read` reads a SiYuan workspace path, not an arbitrary local file. Unsupported syntax, path escape, unmapped dot-prefixed image, or unresolved wikilink blocks apply until the caller supplies a policy.

## P2: resolve identities and dependencies

Resolve exact notebook, parent path, existing targets, and dependencies before writing. Persist one mapping-ledger row per source document/block/asset/AV/field/row/view/template with stable source key, actual target ID/path, status, normalization, and readback evidence.

```bash
siyuan-sisyphus document lookup --notebook '<notebook-id>' --hpath '<target-parent-hpath>' --include-json '["id","path","hpath","docInfo"]' --json
```
```bash
siyuan-sisyphus document create --notebook '<notebook-id>' --path '<target-document-path>' --markdown '<preprocessed-markdown>' --json
```
```bash
siyuan-sisyphus document lookup --id '<returned-document-id>' --include-json '["id","path","hpath","docInfo"]' --json
```
```bash
siyuan-sisyphus file upload-asset --assets-dir-path '<approved-assets-dir>' --local-file-path '<approved-staged-file>' --json
```
```bash
siyuan-sisyphus av get --id '<av-id>' --block-id '<database-block-id>' --json
```
```bash
siyuan-sisyphus av get-attribute-view-keys --id '<av-id>' --json
```

Create missing documents only after approval. Generated target IDs are recorded; this action set cannot preserve source IDs or force remapping. On lost acknowledgement, perform one identity-fixed read and classify the outcome; never resend blindly.

## P3: bounded writes

Apply a reviewed manifest incrementally under one writer and dependency order. Prefer explicit `document.create`, additive `block.append/insert`, scoped `block.update`, and typed AV actions. Do not root-overwrite documents containing AV, mirrors, super blocks, HTML, media, or other complex native blocks without a separate contract.

```bash
siyuan-sisyphus block append --parent-id '<resolved-parent-id>' --data-type 'markdown' --data '<one-reviewed-block>' --json
```
```bash
siyuan-sisyphus block insert --blocks-json '[{"previousID":"<resolved-previous-id>","dataType":"markdown","data":"<one-reviewed-block>"}]' --json
```
```bash
siyuan-sisyphus block update --items-json '[{"id":"<reviewed-leaf-block-id>","dataType":"markdown","data":"<replacement-block-content>"}]' --json
```
```bash
siyuan-sisyphus block set-attrs --id '<reviewed-block-id>' --attrs-json '{"custom-source-key":"<stable-source-key>"}' --json
```
```bash
siyuan-sisyphus av add-rows --av-id '<av-id>' --block-ids-json '["<bound-document-block-id>"]' --view-id '<view-id>' --json
```
```bash
siyuan-sisyphus av set-cells --av-id '<av-id>' --cells-json '[{"rowID":"<row-item-id>","columnID":"<column-key-id>","valueType":"text","text":"<typed-value>"}]' --json
```

Asset upload is an explicit approved local-file operation; use only the returned asset path. It is not a recursive importer. HTTP success remains provisional until exact readback.

## P4: structural readback

Read stable IDs and continue every advertised window/page before search or UI observations.

```bash
siyuan-sisyphus document get-doc --id '<returned-document-id>' --mode 'markdown' --block-start '0' --block-limit '50' --token-budget '2000' --include-block-ids --json
```
```bash
siyuan-sisyphus block get-kramdown --id '<written-block-id>' --json
```
```bash
siyuan-sisyphus block get-children --id '<resolved-parent-id>' --page '1' --page-size '200' --json
```
```bash
siyuan-sisyphus block dom --id '<written-block-id>' --json
```
```bash
siyuan-sisyphus block get-attrs --id '<reviewed-block-id>' --json
```
```bash
siyuan-sisyphus file get-doc-assets --id '<returned-document-id>' --asset-type 'all' --json
```
```bash
siyuan-sisyphus av get --id '<av-id>' --json
```
```bash
siyuan-sisyphus av render --id '<av-id>' --view-id '<view-id>' --page '1' --page-size '50' --json
```

Check exact notebook/path, document/block identity, parent/sibling order, list containment, tables/images/references, typed AV values, and relation endpoints. Observe whether a callout is `NodeCallout` or `NodeBlockquote`; if conversion is needed, report the known gap. `file.extract_doc` and `file.export_md` supplement evidence but cannot prove exact .sy or UI state.

## P5: three independent gates

1. Schema/data: mapping ledger, IDs/paths, blocks, AV definitions/keys/rows/typed cells/relation endpoints, templates, normalization, and unresolved items read back.
2. Functional view/workflow: relevant AV filters/sorts/groups/layouts, relations/rollups, carrier bindings, and one bounded workflow are evidenced.
3. User presentation: approved real UI observation confirms entry pages, visible fields/order/labels, device route, and absence of internal markers.

Schema/data PASS never implies functional or presentation completion. Without live UI evidence, report presentation as unverified. Never hard-code FLO.W fields, exam labels, Chinese tags, personal notebooks, host paths, ports, tokens, source IDs, or secrets.
