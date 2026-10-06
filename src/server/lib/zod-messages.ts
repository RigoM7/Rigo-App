import { z } from 'zod';

// Plain-language validation messages for every schema without its own message. Without this, zod's
// defaults ("Too big: expected string to have <=80 characters") reach people's screens.

const n = (v: unknown) => (typeof v === 'bigint' ? v.toString() : String(v));

export function plainMessage(iss: any): string | undefined {
  switch (iss.code) {
    case 'too_big': {
      const max = Number(iss.maximum);
      if (iss.origin === 'string') return `Use ${n(iss.maximum)} characters or fewer.`;
      if (iss.origin === 'array' || iss.origin === 'set') return `Choose ${n(iss.maximum)} or fewer.`;
      if (iss.origin === 'file') return 'This file is too large.';
      if (iss.origin === 'date') return 'Choose an earlier date.';
      return Number.isFinite(max) ? (iss.inclusive === false ? `Enter less than ${n(iss.maximum)}.` : `Enter ${n(iss.maximum)} or less.`) : 'This number is too large.';
    }
    case 'too_small': {
      if (iss.origin === 'string') return Number(iss.minimum) <= 1 ? 'This is required.' : `Use at least ${n(iss.minimum)} characters.`;
      if (iss.origin === 'array' || iss.origin === 'set') return Number(iss.minimum) <= 1 ? 'Choose at least one.' : `Choose at least ${n(iss.minimum)}.`;
      if (iss.origin === 'date') return 'Choose a later date.';
      return iss.inclusive === false ? `Enter more than ${n(iss.minimum)}.` : `Enter ${n(iss.minimum)} or more.`;
    }
    case 'invalid_type': {
      if (iss.input === undefined || iss.input === null) return 'This is required.';
      switch (iss.expected) {
        case 'int': return 'Enter a whole number.';
        case 'number': case 'bigint': return 'Enter a number.';
        case 'boolean': return 'Choose yes or no.';
        case 'string': return 'Enter text.';
        case 'date': return 'Enter a valid date.';
        case 'array': return 'Choose from the list.';
        default: return 'Enter a valid value.';
      }
    }
    case 'invalid_format':
      switch (iss.format) {
        case 'email': return 'Enter a valid email address.';
        case 'url': return 'Enter a valid web address, starting with https://.';
        case 'uuid': case 'guid': case 'cuid': case 'cuid2': case 'ulid': return 'Choose a valid option.';
        case 'datetime': case 'date': case 'time': return 'Enter a valid date and time.';
        case 'regex': return 'Use the format shown.';
        default: return 'Enter a valid value.';
      }
    case 'invalid_value': return 'Choose one of the options.';
    case 'not_multiple_of': return 'Enter a valid number.';
    case 'unrecognized_keys': return 'Remove the extra information and try again.';
    case 'invalid_union': case 'invalid_key': case 'invalid_element': return 'Enter a valid value.';
    default: return 'Enter a valid value.';
  }
}

z.config({ customError: plainMessage });
