# river-data

**A time-series platform for environmental monitoring that keeps sensor records, field and
laboratory observations, and the values derived from them, each traceable to its source.**

## Contents

- [Summary](#summary)
- [Statement of need](#statement-of-need)
- [Concepts](#concepts)
- [Design principles](#design-principles)
- [Functionality](#functionality)
    - [Observation types](#observation-types)
    - [Visits and replicates](#visits-and-replicates)
    - [Instruments and corrections](#instruments-and-corrections)
    - [Ingestion and pairing](#ingestion-and-pairing)
    - [Quality control](#quality-control)
    - [Derived quantities](#derived-quantities)
    - [Provenance and change history](#provenance-and-change-history)
    - [Aggregation, visualisation and access](#aggregation-visualisation-and-access)
    - [Alarms and notifications](#alarms-and-notifications)
    - [Access control](#access-control)
    - [Processing jobs](#processing-jobs)
- [Limitations](#limitations)
- [Installation](#installation)
- [Repositories](#repositories)
- [Attribution](#attribution)
- [License](#license)

## Summary

river-data stores environmental observations in a single time-series database and serves them
through a web dashboard, an authenticated API and a public read-only API. It handles two kinds of
observation: high-frequency series recorded automatically by field sensors, and low-frequency
observations made at a site at one time, in the field or later in a laboratory, often in
replicate. Derived quantities are computed from both with versioned formulas.

Each stored value carries the site, observed property and instrument it belongs to, the
calibration or standard curve that corrected it, the formula version and inputs it was computed
from, and a record of every change made to it. A new database contains no sites, properties,
instruments or formulas; each deployment defines its own.

## Statement of need

An environmental measurement is interpretable only with its context: where and when it was made,
with which instrument, under which calibration, by which calculation, and whether it has been
corrected since. Monitoring programmes that combine continuous sensors with periodic sampling
hold that context in several places (logger software, laboratory spreadsheets, per-project
databases), which makes three tasks difficult:

- comparing sensor series against reference measurements taken by hand;
- recomputing derived values when a calibration, a formula or an input changes;
- stating, for any published value, how it was obtained and what has changed since.

river-data keeps observations, their instruments and corrections, their derivations and their
change history in one schema, so that each of these is a query rather than a reconstruction.

## Concepts

| Term | Definition |
|------|------------|
| Site | A monitoring location |
| Parameter | A measured quantity, with a code, a name and default units |
| Site parameter | One parameter observed at one site, with its own units, interval and precision |
| Instrument | A field sensor or a laboratory instrument |
| Deployment | An instrument observing one parameter at one site over a time interval |
| Data stream | One series of observations arriving from one source |
| Reading | One observation: a result at one time, with its raw value and its corrected value |
| Visit | All low-frequency observations made at one site at one time |
| Replicate | One of several repeated observations of the same property at the same visit |
| Calibration | A linear correction of a sensor over a validity interval |
| Standard curve | A linear correction of a laboratory method, selected per observation |
| Formula | A versioned calculation producing a derived reading |

The core of the database schema, generated from the migrations:

![Core schema](https://raw.githubusercontent.com/RIVER-EPFL/river-data-api/main/docs/schema-core.svg)

Every table is in the
[full schema diagram](https://github.com/RIVER-EPFL/river-data-api/blob/main/docs/schema.svg),
and the API README describes the data model in words.

## Design principles

- **Replicates are the data.** The mean and standard deviation of a replicate group are computed
  by the database from the stored replicates, never entered.
- **The standard deviation is the sample standard deviation** (denominator n-1).
- **Nothing is deleted.** A retracted value is withdrawn, reversibly; a correction in use is
  retired, not removed.
- **Every change that moves a value is recorded,** with the value before and after, the author,
  the time and the reason.
- **Provenance is recorded by the server,** never supplied by the sender of the data.
- **Attribution comes from the pairing.** Site, parameter and instrument are assigned when a data
  stream is paired, never taken from the incoming data.
- **Raw values are retained.** A corrected value names the calibration or curve that produced it.
- **Recomputation is scoped.** A change recomputes only the values that depend on it, in
  dependency order.
- **New data is admitted; changes are reviewed.** Incoming observations are published on arrival;
  a source's change to a stored value, and entries from reviewed contributors, wait for a person.

## Functionality

### Observation types

Each reading is one of three types, which determines how it is plotted, aggregated and alarmed.

| Type | Origin | Aggregated into hourly to monthly means | Plotted as |
|------|--------|-----------------------------------------|------------|
| High-frequency | Recorded automatically by a sensor, typically every few minutes | Yes | Line |
| Low-frequency | Made at a visit: a field reading, or a laboratory analysis of a collected sample | No | Point at the replicate mean, with a bar of one standard deviation |
| Derived | Computed by a formula | Yes | — |

The type is declared per data stream or inherited from the instrument, and a data stream can be
reclassified afterwards; its stored readings follow.

### Visits and replicates

A visit groups every low-frequency observation made at one site at one time, so that the
replicates of a field day and the values derived from them stay together.

- Any number of replicates can be recorded; a missing replicate is left empty.
- For two or more replicates, the database computes n, mean, sample standard deviation, median,
  minimum and maximum, excluding flagged replicates. A single observation stands as itself.
- An imported mean or standard deviation that disagrees with its own replicates is replaced by the
  computed value, and the disagreement is kept for review.
- Visits are entered in a spreadsheet grid (one row per visit, one column group per parameter), by
  CSV, or through the API. Each visit is saved independently, and a second visit at the same site
  and time is refused.

### Instruments and corrections

Each reading names the instrument that produced it and keeps its raw value apart from its
correction, so an instrument change is visible in a series and a correction can be revised later.

- A deployment assigns an instrument to a site and parameter over an interval. Creating, ending or
  moving a deployment reassigns the readings in the affected interval.
- A calibration is a linear correction (slope and intercept) valid over an interval. Changing it
  recomputes the corrected values in that interval and every value derived from them.
- A standard curve is a linear correction of a laboratory method, held by an instrument and
  selected per observation by date and label.
- A correction in use is retired rather than deleted, after a preview of the values it would
  change. An hourly check recomputes any corrected value that no longer matches its correction.
- A misattributed reading is fixed by correcting the deployment or calibration, not the reading, so
  the whole interval is treated the same way.

### Ingestion and pairing

Observations arrive as data streams and are attributed by pairing, a single decision about which
site, parameter and instrument a stream represents.

- An unpaired stream is stored but not published. Pairing attributes its full history.
- A pairing plan pairs every stream of a source in one step, after each proposed site, parameter,
  instrument and curve has been confirmed or skipped. A plan can be reverted.
- Sync services poll external systems on a schedule. A service is built on river-data-core by
  implementing two functions: which streams exist, and which readings are new.
- For sources edited after the fact, each sync pass compares a time window with the stored values.
  New values are admitted; a changed value becomes a proposal that a manager accepts or rejects;
  a value removed at the source is withdrawn.
- A pass that would change or withdraw more than 15% of its window (above a minimum count), or an
  entire replicate column, is held until a manager releases it. Every pass records the number of
  values added, changed, withdrawn and held.
- CSV import maps columns by name, alias or parameter code and previews the result before storing.
  API batch uploads are atomic: every row is stored or none is.

### Quality control

- **Seasonal range check.** Each new low-frequency value is compared with all stored values of the
  same site and parameter in a five-month window centred on its month, across all years (raw
  against raw, excluding flagged, withdrawn and pending values). Values outside the 10th to 90th
  percentile warn; they are not rejected. Values are saved only after the check has run on them.
- **Flags.** A flagged value stays visible but leaves statistics and aggregates, and values derived
  from it are recomputed.
- **Review.** Entries by reviewed contributors are pending: excluded from the public API, alarms,
  statistics and the range check until a manager verifies them. Rejection withdraws the value and
  what was derived from it.
- **Derivation audit.** Missing, outdated and skipped derived values are reported to a review queue
  alongside sync proposals and held sync passes.
- **Sensor against reference.** Each low-frequency value can be set beside the mean and standard
  deviation of the corresponding sensor series over a window after the visit (2 to 6 hours by
  default).

### Derived quantities

Derived quantities are computed with versioned formulas, and each result records the formula
version, inputs, constants and curves it used.

- A formula is a set of inputs, intermediate steps and outputs. Available operations: arithmetic,
  `exp`, `round`, `min`, `max`, `if`, `coalesce`, and `mean(x)` and `sd(x)` over replicates, with
  named constants, standard curves and site properties (eg. altitude) as inputs.
- A step can be shared between formulas (eg. barometric pressure from altitude).
- Saving a change creates a new version, applied to new values only or recomputed over stored ones.
- A change to an input recomputes the dependent values at that visit, in order. A division by zero
  leaves the stored value unchanged and raises a finding.
- Formulas also run over high-frequency series. A low-frequency input can be carried forward from
  one visit to the next; it is never interpolated.
- Calculations that do not fit the formula language run as R scripts in an isolated runner with no
  database or credential access.
- A new database contains twelve constants used in dissolved-gas calculations: gas and Henry
  constants and the van't Hoff term, average laboratory temperature and pressure, syringe and vial
  volumes, and the CH4 fraction in standard air. Changing a constant recomputes the values that
  used it.

### Provenance and change history

Any value can be traced to its origin and to every change made to it since.

- A reading's record shows its source, arrival time, instrument, correction, visit and derivation,
  with each input beside that input's current value.
- The history of a reading lists each recorded change; any change can be rolled back, and an edit
  over several values rolls back as one.
- Each edit previews the values it will change before it is applied.

| Operation | Effect |
|-----------|--------|
| Flag | Marks a value as unreliable; it remains visible and leaves statistics and aggregates |
| Withdraw | Retracts a low-frequency value or a visit, reversibly; high-frequency values are flagged instead |
| Correct | Replaces a value; a derived value is corrected through its inputs |
| Roll back | Reverses one recorded change |

### Aggregation, visualisation and access

- **Aggregates.** High-frequency and derived series are averaged at 1 hour, 6 hours, 12 hours,
  1 day, 1 week and 1 month, excluding flagged and unattributed readings. The current period is
  computed on request, so a new reading appears immediately.
- **Charts.** Per-site time series of every parameter; comparison of one parameter across sites
  with summary statistics (count, missing values, median, mean, standard deviation, minimum,
  maximum); scatter plots of two parameters with a linear fit; day-of-year plots folding several
  years onto one seasonal axis.
- **Time.** Times are stored and served in UTC.
- **Exports.** CSV, JSON or NDJSON per site at full stored precision, optionally with flags,
  correction references and replicate statistics; replicates export separately, keyed by sample.
- **Public API.** Unauthenticated, read-only and rate-limited, for projects that opt in: sites,
  parameters, readings (JSON, CSV, NDJSON) and aggregates, with documentation at
  `/api/public/{code}/docs`, eg. `/api/public/{code}/sites/{site_code}/readings?format=csv`.
  Low-frequency values are served as replicate means (`include_sample_stats` adds n, mean,
  `sd_sample`, minimum and maximum). Only parameters marked public are served, never flagged or
  pending values. The serving rules are versioned (currently 3.0.0).
- **Reference pressure.** A site can store the air pressure of a chosen MeteoSwiss weather station.

### Alarms and notifications

| Rule | Behaviour |
|------|-----------|
| Thresholds | Set per parameter, optionally overridden per site |
| Instrument range | An optional manufacturer range raises a separate alarm, distinguishing instrument failure from an unusual environmental value |
| Episodes | An alarm opens on a breach, can be acknowledged, and closes when values return to range |
| Observation type | High- and low-frequency series alarm separately; low-frequency values are judged on their mean |
| Exclusions | Pending values, replicate groups with every replicate flagged, retired site parameters |

Notifications are sent by browser push (Web Push), per user and per alarm kind and site. An
optional forecast warns when a logger's battery voltage trend reaches 10.5 V within 14 days.

### Access control

Authentication is through Keycloak. Authorisation has four ordered levels, and each user is
granted the projects they can see.

| Level | Keycloak role | Permissions |
|-------|---------------|-------------|
| Reviewed contributor | `riverdata-intern` | Read, enter data and run formulas; entries are pending until verified |
| Contributor | `riverdata-river` | Enter data without review; manage standard curves |
| Manager | `riverdata-manager` | Parameters, instruments, alarm thresholds, review, and source change proposals |
| Administrator | `riverdata-admin` | Users, projects, tokens, data streams, pairing, formulas and constants |

Machine clients use API tokens, which can be limited to one project, are logged on use, can be
rotated or revoked, and cannot create other tokens.

### Processing jobs

Recomputation, pairing plans and imports run as tracked background jobs, retried on failure, with
a per-run log and counts, and a notification when a job fails permanently. Recurring work (alarm
evaluation, hourly repair and cleanup, notification delivery, reference pressure retrieval) runs
on configurable schedules.

## Limitations

- Corrections are linear (slope and intercept). Sensor drift is not modelled.
- Formulas run at visits entered in river-data. Values imported from other systems are stored as
  received, with their own derived values unchanged.
- A low-frequency input to a formula is carried forward from the previous visit, never
  interpolated; replicated inputs are not carried forward.
- The seasonal range check applies to interactive entry and CSV import, not to API batch uploads.
- Observations are never deleted; retraction is a reversible withdrawal.
- There is no scheduled recomputation of all values; recomputation follows changes.
- The standard deviation denominator is fixed at n-1.
- Instruments and calibrations are assigned by deployment, not per reading.
- There is no data request workflow; published data is served by the public API.

## Installation

The dashboard is SvelteKit 2 and Svelte 5 (built static, served under `/admin`), with Tailwind CSS
v4, uPlot, Leaflet, Handsontable and keycloak-js.

Clone the repositories side by side (the compose file expects the Vaisala service in a folder
named `river-data-vaisala`), then start the stack from `river-data-ui`:

```bash
mkdir -p river-data && cd river-data
git clone git@github.com:RIVER-EPFL/river-data-ui.git
git clone git@github.com:RIVER-EPFL/river-data-api.git
git clone git@github.com:RIVER-EPFL/river-data-sync-vaisala.git river-data-vaisala
git clone git@github.com:RIVER-EPFL/river-data-rshiny.git
cd river-data-ui
docker compose up -d
```

The API and dashboard reload from the mounted source.

| Service | Address |
|---------|---------|
| Dashboard | http://localhost:88/admin/ |
| API | http://localhost:3005 (documentation at `/docs`) |
| Keycloak | http://localhost:8180, with the development realm from `keycloak-realm-dev.json` (one user per role level) |
| PostgreSQL | localhost:5443 |
| Traefik | http://localhost:8088 |

Each sync service needs access to its source. Without one, start only the API and database:
`docker compose up -d river-data-api river-db-ui`.

```bash
npm run check   # svelte-check
npm run test    # vitest
```

## Repositories

| Repository | Content |
|------------|---------|
| [river-data-api](https://github.com/RIVER-EPFL/river-data-api) | REST API, database schema and R runner; documents the data model and endpoints |
| [river-data-ui](https://github.com/RIVER-EPFL/river-data-ui) | This dashboard |
| [river-data-core](https://github.com/RIVER-EPFL/river-data-core) | Library for writing sync services |
| [river-data-sync-vaisala](https://github.com/RIVER-EPFL/river-data-sync-vaisala) | Sync service for Vaisala viewLinc logger networks |
| [river-data-rshiny](https://github.com/RIVER-EPFL/river-data-rshiny) | Sync service for R/Shiny data portal databases |

## Attribution

Developed by [Evan Thomas](https://github.com/evanjt) at EPFL Valais for the
[River Ecosystems Laboratory](https://www.epfl.ch/labs/river/).

## License

MIT
