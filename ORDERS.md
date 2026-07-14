# OpenClaw Night Watch Orders

## Mission

Inspect the Kepler solar-irradiance endpoint on every wake, classify the latest reading, record the result, and reply only when a state transition requires it.

## Inspection Steps

1. Query `https://planet.turingguild.com/world/solar-irradiance`.
2. Read `solarIrradiance.wPerM2` from the JSON response.
3. Read `solarIrradiance.condition` from the JSON response.
4. Compare the new reading against the 450 W/m2 threshold.
5. Check whether there is already an open low-sunlight incident in [incidents.md](/Users/amychang/Desktop/labs/habitat-cli/incidents.md).
6. Check the most recent entry in [observations.md](/Users/amychang/Desktop/labs/habitat-cli/observations.md).

## Classification Rules

- `NORMAL`: `wPerM2` is 450 or greater and there is no open incident.
- `INCIDENT`: `wPerM2` is below 450.
- `RECOVERED`: `wPerM2` returns to 450 or greater after an incident.

## Recording Rules

- Append one observation every run to [observations.md](/Users/amychang/Desktop/labs/habitat-cli/observations.md).
- Every observation must include: timestamp, `wPerM2`, condition, classification, and a short note.
- Use [incidents.md](/Users/amychang/Desktop/labs/habitat-cli/incidents.md) for one incident per low-sunlight episode.
- Create an incident when the reading first crosses below 450.
- While sunlight remains below 450, update the same incident instead of creating duplicates.
- Do not create duplicate incidents while sunlight remains low.
- When sunlight returns to 450 or greater, record the recovery time on that same incident and mark it recovered.

## Final Response Rules

- If the new result is `NORMAL` and there is no state change, return exactly `NO_REPLY`.
- On the first transition into `INCIDENT`, return one concise Discord alert with the timestamp and `wPerM2` reading.
- If the result remains `INCIDENT` with no state change, return exactly `NO_REPLY`.
- On the transition from `INCIDENT` to `RECOVERED`, return one concise recovery message with the timestamp and `wPerM2` reading.
- During continued normal operation after recovery, return exactly `NO_REPLY`.

## Notes

- Treat the most recent observation as the comparison point for deciding whether the state changed.
- The only allowed outward messages are the first incident alert, the recovery message, or the exact string `NO_REPLY`.
