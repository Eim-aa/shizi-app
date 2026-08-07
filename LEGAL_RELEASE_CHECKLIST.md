# Release License Checklist

This file records release gates, not legal advice. A project owner or qualified
reviewer must close every `BLOCKED` row before public App Store distribution.

| Component | Repository evidence | Current state | Release action |
| --- | --- | --- | --- |
| Project-authored code and content | No root `LICENSE` has been selected | BLOCKED | Owner chooses the project license and confirms ownership/contributor permissions. |
| Hanzi Writer 3.7.3 (`hanzi-writer.min.js`) | MIT notice and pinned SHA-256 in `THIRD_PARTY_NOTICES.md` | RECORDED | Ship the notice and `sources/LICENSE-MIT-HANZI-WRITER.txt`. |
| Hanzi Writer Data 2.0.1 baseline (6,854 records) | Upstream identifies Arphic-derived data | RECORDED, COMPLIANCE REVIEW REQUIRED | Ship the unmodified Arphic license; confirm modified-data notice/source-availability obligations. |
| AnimCJK-derived supplement (363 records) | Exact upstream commit and transformations are in the vector audit; upstream classifies Hanzi graphics under Arphic Public License | RECORDED, COMPLIANCE REVIEW REQUIRED | Confirm the transformed JSON is distributed under the required terms with its modifications available. |
| MOE/stroke-order supplement (10 records) | Source pages and hashes exist, but the repository contains no captured redistribution terms | BLOCKED | Obtain and archive applicable terms or written authorization. |
| Human-generated supplement (8 records) | Technical and human acceptance exists, but authorship/rights grants are not recorded | BLOCKED | Record authors and an explicit redistribution grant. |
| Stroke-order merged supplement (59 records) | Technical provenance records transformations, but does not establish a reusable upstream license | BLOCKED | Trace each source payload and archive its applicable redistribution terms. |
| Make Me a Hanzi metadata | LGPL-3.0-or-later notice is present | COMPLIANCE REVIEW REQUIRED | Confirm the modified data/source offer and App distribution obligations. |

The 440 supplemental records must not be described as commercially cleared
until the four supplement rows above are closed. Technical or visual approval
does not grant copyright permission.

Issue #133 tracks exposing these notices inside the shipped app. Until that is
implemented, release packaging must provide another user-accessible route to
the complete notices and license texts.
