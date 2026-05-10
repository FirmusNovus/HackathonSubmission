-- Bar-association issuer side. Lawyers admitted by the (stand-in) bar — the
-- data this institution attests to (jurisdiction, admission date, bar number).
CREATE TABLE IF NOT EXISTS bar_subjects (
    id                      INTEGER PRIMARY KEY,
    display_name            TEXT NOT NULL,
    eth_address             TEXT NOT NULL UNIQUE,
    given_name              TEXT NOT NULL,
    family_name             TEXT NOT NULL,
    jurisdiction            TEXT NOT NULL,
    bar_admission_date      TEXT NOT NULL,
    bar_admission_number    TEXT NOT NULL
);
