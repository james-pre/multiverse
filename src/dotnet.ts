/** .NET counts time in 100 nanosecond ticks since the start of year 1 */
const ticksAtUnixEpoch = 621_355_968_000_000_000n;

/** Converts ticks of a `DateTime` in local time, which is how games made with .NET usually save times */
export function ticksToDateTime(ticks: bigint): Temporal.PlainDateTime {
	return Temporal.Instant.fromEpochNanoseconds((ticks - ticksAtUnixEpoch) * 100n)
		.toZonedDateTimeISO('UTC')
		.toPlainDateTime();
}
