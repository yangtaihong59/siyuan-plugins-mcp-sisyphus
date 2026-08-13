---
name: siyuan-mcp-import-migration
description: MCP staged playbook for Markdown and external database migration with explicit targets, mappings, bounded writes, and layered readback.
---

# SiYuan Import and Migration with MCP

Use this scenario for caller-preprocessed Markdown or external database/template migration. It does not parse arbitrary local files, promise NodeCallout conversion, read exact .sy files, preserve source IDs, decrypt notebooks, or perform browser UI acceptance.

## P0: freeze the contract

Record source descriptor/hash, target notebook/path, scope, conflict policy, business-profile boundary, recoverable safety net, one-writer state, confirmation, and the three acceptance gates before W3 writes.

```text
system(action="get_version")
```
```text
notebook(action="list")
```
```text
notebook(action="get_permissions")
```
```text
system(action="conf", mode="summary")
```
```text
fs(action="tree", path="<target-workspace-path>", maxDepth=4)
```

Stop on an ambiguous target, missing authorization or safety net, multiple writers, unresolved business rules, or a direct .sy/encrypted request. Titles, labels, search hits, and UI positions are discovery hints, never foreign keys.

## P1: validate the external source

The caller or a separately reviewed preprocessor supplies preprocessed Markdown, source hash, transform report, ordered image refs, stable wikilink map, and unresolved diagnostics. It removes YAML frontmatter and normalizes supported image/callout/list syntax without inventing IDs or silently dropping values.

```text
fs(action="read", path="<staged-workspace-document>", blockStart=0, blockLimit=50, tokenBudget=2000, includeBlockIds=true)
```
```text
fs(action="search", path="<staged-workspace-root>", query="<source-keyword>", page=1, pageSize=20)
```
```text
file(action="list_templates", query="<template-keyword>", page=1, pageSize=20)
```
```text
file(action="read_template", path="<resolved-template-path>", offset=0, limit=8000)
```

`fs.read` reads a SiYuan workspace path, not an arbitrary local file. Unsupported syntax, path escape, unmapped dot-prefixed image, or unresolved wikilink blocks apply until the caller supplies a policy.

## P2: resolve identities and dependencies

Resolve exact notebook, parent path, existing targets, and dependencies before writing. Persist one mapping-ledger row per source document/block/asset/AV/field/row/view/template with stable source key, actual target ID/path, status, normalization, and readback evidence.

```text
document(action="lookup", notebook="<notebook-id>", hpath="<target-parent-hpath>", include=["id","path","hpath","docInfo"])
```
```text
document(action="create", notebook="<notebook-id>", path="<target-document-path>", markdown="<preprocessed-markdown>")
```
```text
document(action="lookup", id="<returned-document-id>", include=["id","path","hpath","docInfo"])
```
```text
file(action="upload_asset", assetsDirPath="<approved-assets-dir>", localFilePath="<approved-staged-file>")
```
```text
av(action="get", id="<av-id>", blockID="<database-block-id>")
```
```text
av(action="get_attribute_view_keys", id="<av-id>")
```

Create missing documents only after approval. Generated target IDs are recorded; this action set cannot preserve source IDs or force remapping. On lost acknowledgement, perform one identity-fixed read and classify the outcome; never resend blindly.

## P3: bounded writes

Apply a reviewed manifest incrementally under one writer and dependency order. Prefer explicit `document.create`, additive `block.append/insert`, scoped `block.update`, and typed AV actions. Do not root-overwrite documents containing AV, mirrors, super blocks, HTML, media, or other complex native blocks without a separate contract.

```text
block(action="append", parentID="<resolved-parent-id>", dataType="markdown", data="<one-reviewed-block>")
```
```text
block(action="insert", blocks=[{"previousID":"<resolved-previous-id>","dataType":"markdown","data":"<one-reviewed-block>"}])
```
```text
block(action="update", items=[{"id":"<reviewed-leaf-block-id>","dataType":"markdown","data":"<replacement-block-content>"}])
```
```text
block(action="set_attrs", id="<reviewed-block-id>", attrs={"custom-source-key":"<stable-source-key>"})
```
```text
av(action="add_rows", avID="<av-id>", blockIDs=["<bound-document-block-id>"], viewID="<view-id>")
```
```text
av(action="set_cells", avID="<av-id>", cells=[{"rowID":"<row-item-id>","columnID":"<column-key-id>","valueType":"text","text":"<typed-value>"}])
```

Asset upload is an explicit approved local-file operation; use only the returned asset path. It is not a recursive importer. HTTP success remains provisional until exact readback.

## P4: structural readback

Read stable IDs and continue every advertised window/page before search or UI observations.

```text
document(action="get_doc", id="<returned-document-id>", mode="markdown", blockStart=0, blockLimit=50, tokenBudget=2000, includeBlockIds=true)
```
```text
block(action="get_kramdown", id="<written-block-id>")
```
```text
block(action="get_children", id="<resolved-parent-id>", page=1, pageSize=200)
```
```text
block(action="dom", id="<written-block-id>")
```
```text
block(action="get_attrs", id="<reviewed-block-id>")
```
```text
file(action="get_doc_assets", id="<returned-document-id>", assetType="all")
```
```text
av(action="get", id="<av-id>")
```
```text
av(action="render", id="<av-id>", viewID="<view-id>", page=1, pageSize=50)
```

Check exact notebook/path, document/block identity, parent/sibling order, list containment, tables/images/references, typed AV values, and relation endpoints. Observe whether a callout is `NodeCallout` or `NodeBlockquote`; if conversion is needed, report the known gap. `file.extract_doc` and `file.export_md` supplement evidence but cannot prove exact .sy or UI state.

## P5: three independent gates

1. Schema/data: mapping ledger, IDs/paths, blocks, AV definitions/keys/rows/typed cells/relation endpoints, templates, normalization, and unresolved items read back.
2. Functional view/workflow: relevant AV filters/sorts/groups/layouts, relations/rollups, carrier bindings, and one bounded workflow are evidenced.
3. User presentation: approved real UI observation confirms entry pages, visible fields/order/labels, device route, and absence of internal markers.

Schema/data PASS never implies functional or presentation completion. Without live UI evidence, report presentation as unverified. Never hard-code FLO.W fields, exam labels, Chinese tags, personal notebooks, host paths, ports, tokens, source IDs, or secrets.
