---
name: siyuan-mcp-visual-assets
description: MCP playbook for semantic SVG charts and figures, approved asset upload, and verified SiYuan block embedding.
---

# SiYuan Visual Assets with MCP

Choose the narrowest route: data/config-driven SVG for statistical charts, semantic geometry for explanatory figures, and an existing uploaded asset when vector reconstruction is not appropriate. This scenario does not add a picture-generation tool, renderer, async runner, or platform-specific image utility.

## Generate and review

1. Read the source image or data and record chart type, series, categories, values, axes, units, grid lines, markers, title, legend, geometry, and unresolved readings. Do not invent unclear values.
2. Reuse a matching deterministic config/builder shape for charts; for figures, decode structure first and choose semantic geometry. If a supported mathematical relation exists, declare and run a validation such as growth or sum; failed validation returns to data review.
3. Check escaped text, viewBox containment, text bounds and collisions, line/text clearance, stable stroke width, angle/projection/occlusion constraints, and one unique `data-chart-key` matched to the config registry.
4. Semantic correctness comes before pixel similarity. Pixel overlay is optional. A real SiYuan UI review is required for display claims: width, responsive behavior, readability, theme contrast, and embed rendering.

Do not make bitmap tracing the default route. Use it only as constrained coordinate assistance; do not force-vectorize photos, maps, comics, or figures whose meaning is the typeface itself. If text, a list, table, or formula states the meaning clearly, prefer native content.

## Upload and embed

Resolve the exact notebook/document/block ID, parent-child relation, and insertion position before writing. A title, search hit, or UI position is not write authorization.

```text
file(action="upload_asset", assetsDirPath="<approved-assets-dir>", localFilePath="<selected-local-file>")
```

Asset upload reads a user-selected local file and requires explicit approval of both the source file and assets directory. Use the returned asset path as the only subsequent reference; never guess a timestamped filename or preserve a machine-specific path in the Skill.

For an ordinary uploaded image, append one bounded Markdown image block. For inline SVG/HTML, keep all lines in one standalone block; use a complete `NodeHTMLBlock` DOM update only when an existing block is the exact target. A canonical visual block may be reused elsewhere with a query embed pointing to its stable block ID; do not duplicate the SVG body.

```text
block(action="append", parentID="<resolved-parent-id>", dataType="markdown", data="<one-block-markdown-or-inline-html-svg>")
```
```text
block(action="update", items=[{"id":"<existing-leaf-block-id>","dataType":"dom","data":"<complete-node-html-block-dom>"}])
```

## Structural readback

After each write, read the exact affected ID before any search or UI conclusion:

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
file(action="get_doc_assets", id="<resolved-document-id>", assetType="all")
```
```text
search(action="search_assets", query="<asset-filename>", exts=["svg","png"])
```

Confirm block type, parent/sibling order, kramdown, DOM attributes, viewBox, escaped text, returned asset path, `data-chart-key`, canonical embed target, and image/HTML containment. `get_doc_assets` and `search_assets` find references or candidates; neither proves rendering. API success, file existence, SQL/index results, or a renderer invocation cannot replace structural readback or real SiYuan UI review.

If a response is lost or the returned asset path is missing/non-unique, stop and inspect the exact target; do not retry an upload or append blindly. Classify geometry WARNs as repaired, justified exemption, or TODO; after repeated unsuccessful adjustments, stop and report instead of relaxing tolerances.
