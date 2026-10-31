#!/bin/sh
set -eu

: "${SEED_USER_EMAIL:?Set SEED_USER_EMAIL in .env}"
: "${SEED_USER_PASSWORD:?Set SEED_USER_PASSWORD in .env}"
export SEED_USER_EMAIL

# This CLI command also initializes Corteza's schema and built-in resources on
# a fresh database, so the seed job can finish before the web server starts.
users=$(corteza-server users list --query "$SEED_USER_EMAIL" --limit 0)

# Corteza 2026.9 prints: ID, created date, updated date, email, and name.
# An unset updated date is printed as three words: "---- -- --".
# Compare the email column exactly; the query also searches users' names.
if printf '%s\n' "$users" | awk '
    NR > 1 {
        email_column = ($3 == "----" && $4 == "--" && $5 == "--") ? 6 : 4
        if (tolower($email_column) == tolower(ENVIRON["SEED_USER_EMAIL"])) {
            found = 1
        }
    }
    END { exit !found }
'; then
    printf 'Seed user %s already exists; skipping.\n' "$SEED_USER_EMAIL"
    exit 0
fi

printf 'Creating seed administrator %s.\n' "$SEED_USER_EMAIL"
corteza-server users add "$SEED_USER_EMAIL" \
    --password "$SEED_USER_PASSWORD" \
    --role super-admin
printf 'Seed administrator is ready.\n'
