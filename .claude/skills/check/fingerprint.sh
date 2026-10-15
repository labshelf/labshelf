#!/usr/bin/env bash
# Prints a short hash of HEAD plus the uncommitted change.
{ git rev-parse HEAD; git diff HEAD --binary; git ls-files --others --exclude-standard -z | xargs -0 shasum 2>/dev/null; } | shasum | cut -c1-12
