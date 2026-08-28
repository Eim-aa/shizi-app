# Vector supplement final evidence

This directory records the final product disposition of the original 460-character supplement cohort.

- 411 payloads were already human accepted, including 30 unchanged payloads from the original 79-character strokeorder batch.
- 29 reported payloads were corrected, machine-gated, and explicitly human accepted.
- 20 rare characters were removed from practice scope by product decision.
- Final practice supplement: 440/440 human accepted; 0 pending.

The 20 exclusions are product-scope decisions, not claims that vector data cannot exist. Historical pending-review pages remain historical evidence only. The current scope closure is [review-decisions/strokeorder-49-scope-closure.json](review-decisions/strokeorder-49-scope-closure.json).

Historical acceptance and scope-closure records intentionally retain their original production-import prohibition. The later, separate product approval for the exact frozen 29 replacements and 20 exclusions is transcribed in [authorizations/finalize-440-production-import.json](authorizations/finalize-440-production-import.json); the revised import receipt binds both records.

`scripts/verify_vector_data_440.js` fails closed unless all 440 manifest rows match their acceptance record's character, accepted decision, and candidate hash, and unless the authorization → receipt → manifest chain reconciles exactly. Licensing and commercial-use review remain explicitly outside this technical evidence snapshot.
