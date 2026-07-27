# Character-origin data

`data/etymology.json` is generated, not edited by hand. Every published row
has exactly three fields: `char`, `gloss`, and `source`; glosses are limited
to 20 Unicode characters.

## Sources

- `shuowenjiezi/shuowen`, commit
  `6553a350763ce4feca2c5d1cc2cad7e594dc2975`, Apache-2.0. This is the primary
  source for `《说文解字》` rows.
- `BYVoid/OpenCC`, commit
  `8a8ef3eb10e563ed013f27628e6a46a5f0ade7d8`, Apache-2.0. The vendored
  `STCharacters.txt` and `TSCharacters.txt` snapshots are used only to match
  traditional headwords and normalize display forms.
- The existing `sources/make-me-a-hanzi-dict.txt` snapshot, SHA-256
  `744bb05d5b0742e9ee35c37791f94d56a173349b3367569e7ca11e510364d203`,
  LGPL-3.0-or-later. Only explicit pictophonetic metadata or manually
  translated pictographic/ideographic hints are used as a fallback.

Licenses and upstream links are recorded in `THIRD_PARTY_NOTICES.md`.

## Rebuild

```bash
git clone https://github.com/shuowenjiezi/shuowen.git /tmp/shizi-shuowen-source
git -C /tmp/shizi-shuowen-source checkout 6553a350763ce4feca2c5d1cc2cad7e594dc2975
python3 scripts/build_etymology.py --shuowen-dir /tmp/shizi-shuowen-source
python3 scripts/build_etymology.py --shuowen-dir /tmp/shizi-shuowen-source --check
```

The generator checks the Shuowen revision when the source directory is a Git
checkout. It builds the target set from the deck's top 1,000 ranks plus every
radical used by `sources/hanzi_db.json`, then emits both the runtime file and
`generated/etymology-coverage.json`.

## Coverage policy

The current build contains 1,035 rows:

- frequency top 1,000: 906 covered;
- radical characters: 207 of 212 covered;
- sources: 956 Shuowen rows and 79 Make Me a Hanzi rows.

Ninety-seven target characters are intentionally absent. OpenCC one-to-many
resolution runs before exact-headword lookup. The 69 formerly published
one-to-many characters are audited against their fixed deck context in
`scripts/fixtures/etymology_context_audit.json`: 52 select an explicit source
headword with `reviewed-context`, while 17 remain absent. All other one-to-many
forms remain `ambiguous-opencc`; raw search aliases remain unpublished unless
their historical relationship is listed in `SHUOWEN_ALIASES`.

The fixed accuracy fixture locks representative correct selections including
`最后→後`, `这里→裏`, `几个→幾`, `积极→極`, and `胜利→勝`, as well as intentional
omissions such as `工厂→廠` where the pinned source has no reliable record. The
regression suite also rejects every published OpenCC one-to-many character whose
match kind is not `reviewed-context`.

Candidate generation is not publication approval. Sixty-five candidates selected
by the global readability scan or an existing accuracy fixture are fixed in
`scripts/fixtures/etymology_copy_review.json`: 62 have individually approved
plain-language copy and three remain absent. Unreviewed structural clauses
containing extension characters are removed; a global regression rule rejects
every final row that still contains an extension character or an opaque form
such as a rare word followed only by `也/同`.

The deterministic transform removes long citations and commentary, converts
traditional forms for display, keeps at most one short structural sentence,
and rejects anything over 20 characters. Fifty representative rows were then
checked and rewritten for readability without changing their source meaning;
the audit is in `sources/etymology-audit-50.md`.
