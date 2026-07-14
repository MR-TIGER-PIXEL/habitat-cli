# OpenClaw Night Watch

OpenClaw Night Watch is a docs-only runbook for a repeating solar inspection loop.

## Loop

### Wake

Start an inspection cycle.

### Inspect

Query `https://planet.turingguild.com/world/solar-irradiance` and read:

- `solarIrradiance.wPerM2`
- `solarIrradiance.condition`

### Decide

Classify the reading with these rules:

- `NORMAL` when `wPerM2` is 450 or greater and there is no open incident
- `INCIDENT` when `wPerM2` is below 450
- `RECOVERED` when `wPerM2` returns to 450 or greater after an incident

Compare the new classification with the most recent observation to determine whether the state changed.

### Record

Append one entry to [observations.md](/Users/amychang/Desktop/labs/habitat-cli/observations.md) every run. Each entry includes:

- timestamp
- `wPerM2`
- condition
- classification
- short note

Maintain [incidents.md](/Users/amychang/Desktop/labs/habitat-cli/incidents.md) as one incident per low-sunlight episode:

- create the incident on the first drop below 450
- keep updating that same incident while sunlight remains low
- do not create duplicates during the same low-sunlight stretch
- add the recovery time and mark it recovered when sunlight returns to 450 or greater

### Report

Use the final-response contract:

- return exactly `NO_REPLY` for `NORMAL` with no state change
- return one concise Discord alert on the first `INCIDENT` transition
- return exactly `NO_REPLY` for a continued `INCIDENT` with no state change
- return one concise recovery message on the `RECOVERED` transition
- return exactly `NO_REPLY` for continued normal operation after recovery

## Files

- [ORDERS.md](/Users/amychang/Desktop/labs/habitat-cli/ORDERS.md): inspection instructions and response rules
- [observations.md](/Users/amychang/Desktop/labs/habitat-cli/observations.md): append-only observation log
- [incidents.md](/Users/amychang/Desktop/labs/habitat-cli/incidents.md): one incident per low-sunlight episode
