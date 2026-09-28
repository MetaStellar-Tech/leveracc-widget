# Repository instructions

## Documentation languages

- All new or updated explanatory documentation for users, integrators, and maintainers must have an English default file (`*.md`) and a complete Simplified Chinese counterpart (`*.zh-CN.md`) in the same directory. For example, pair `README.md` with `README.zh-CN.md`.
- Place an `English | 简体中文` language selector directly below each document's title. Bold the current language and link the other language to the matching document using a relative path.
- Keep internal documentation links in the reader's current language whenever a translated target exists. Update section anchors when translating headings.
- Update both language versions together. Keep technical facts, section coverage, configuration details, commands, and examples equivalent; do not replace a translation with a summary.
- Add new documentation to the relevant README navigation in both languages. Check the npm package file list for documents intended for distribution, including the targets of language selectors.
- Translate prose, table descriptions, code comments, and illustrative UI text. Preserve API identifiers, commands, paths, configuration keys, and their technical meaning. English examples should default to `locale: "en"`, except examples specifically demonstrating Chinese or language switching.
- Agent instruction files such as `AGENTS.md` are English-only and do not need translated counterparts. Third-party license texts and generated files are excluded from the bilingual requirement; preserve their original contents.

## Documentation verification

- Check reciprocal language selectors, relative documentation links, and section anchors after edits.
- Compare the language versions for matching technical content and example behavior.
- When changing packaged documentation, inspect the npm pack file list with lifecycle scripts disabled, for example `npm pack --dry-run --ignore-scripts --json`. This is a packaging preview, not a publish command.
- Documentation-only changes do not require transaction-flow or browser tests unless they also change runtime behavior.
