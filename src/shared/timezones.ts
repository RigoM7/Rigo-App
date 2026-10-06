// Friendly time zone names. Rigo stores the IANA id (America/Chicago) and shows people a name they
// recognize ("Central Time (Chicago)").

export const TIMEZONE_NAMES: Record<string, string> = {
  'America/New_York': 'Eastern Time (New York)',
  'America/Chicago': 'Central Time (Chicago)',
  'America/Denver': 'Mountain Time (Denver)',
  'America/Phoenix': 'Mountain Time, no daylight saving (Phoenix)',
  'America/Los_Angeles': 'Pacific Time (Los Angeles)',
  'America/Anchorage': 'Alaska Time (Anchorage)',
  'Pacific/Honolulu': 'Hawaii Time (Honolulu)',
  'America/Toronto': 'Eastern Time (Toronto)',
  'America/Vancouver': 'Pacific Time (Vancouver)',
  'America/Mexico_City': 'Central Time (Mexico City)',
  'Europe/London': 'UK Time (London)',
  'Europe/Berlin': 'Central European Time (Berlin)',
  'Australia/Sydney': 'Australian Eastern Time (Sydney)',
};
export const COMMON_TIMEZONES = Object.keys(TIMEZONE_NAMES);

/** "Central Time (Chicago)" for known zones; otherwise the zone's generic name and city. */
export function tzLabel(tz: string) {
  if (TIMEZONE_NAMES[tz]) return TIMEZONE_NAMES[tz];
  const city = (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
    return name && !/^GMT/.test(name) ? `${name} (${city})` : city;
  } catch {
    return city;
  }
}

/** Options for a time zone picker: the common zones, plus the current value and the device's zone if missing. */
export function timezoneOptions(...extra: (string | undefined | null)[]) {
  const ids = [...new Set([...extra.filter((x): x is string => !!x), ...COMMON_TIMEZONES])];
  return ids.map((id) => ({ id, label: tzLabel(id) })).sort((a, b) => a.label.localeCompare(b.label));
}
