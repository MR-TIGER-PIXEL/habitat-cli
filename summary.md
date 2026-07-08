## Tick Logic Summary

My tick logic is local and power-only. One tick represents one simulated second. When `habitat tick --count <n>` runs, the CLI reads the locally saved module data and checks each module’s `runtimeAttributes.status`.

For each module, the CLI looks for a matching value in `runtimeAttributes.powerDrawKw`. For example, if a module is `active`, it uses the module’s `active` power draw. If the module does not have a matching power draw value, it counts as `0 kW`.

The CLI adds all module power draws together to calculate the total current power draw in kilowatts. Since one tick is one second, the CLI converts power draw into energy used per tick by dividing by `3600`.

For example, a total draw of `6.5 kW` uses:

`6.5 / 3600 = 0.0018 kWh`

for one tick.

After calculating the energy needed, the CLI drains that amount from eligible local battery modules. If there are multiple batteries, the drain is split proportionally based on how much energy each battery currently stores. Battery energy is clamped at `0` so it cannot become negative.

Finally, the CLI saves the updated battery energy and increments the local `currentTick`. The tick does not ask Kepler to simulate anything; it only updates the local Habitat CLI state.
