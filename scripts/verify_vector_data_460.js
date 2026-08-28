#!/usr/bin/env node
"use strict";

// Compatibility entry point retained for existing local/CI commands and PR links.
// The finalized cohort contains 440 practice-ready characters, so all checks now
// run through the current manifest/evidence/browser verifier.
require("./verify_vector_data_440.js");
