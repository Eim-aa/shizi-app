# Accepted source replay

`vector-data-381-accepted-source-replay.json.gz` freezes the exact candidate
bytes for the 381 historical acceptances that bind a reviewed candidate rather
than the final two-key App payload.

`scripts/verify_vector_data_440.js` checks every frozen byte sequence against
the SHA-256 in the original human-acceptance record, extracts only `strokes`
and `medians`, and compares both arrays with the committed production payload.
The other 59 payloads are already bound directly because their accepted hash
is the final payload hash.

The bundle is generated with:

```sh
python3 scripts/build_vector_source_replay_bundle.py \
  --source-root /path/to/historical/vector-data-worktree
```

The 2026-08-07 evidence index and production-approval chain remain unchanged;
this replay bundle is a later clean-clone regression fixture. Licensing and
commercial-use review remain outside this technical evidence.
