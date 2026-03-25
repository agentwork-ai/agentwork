const cron = require('node-cron');

const WEEKDAY_TO_CRON = {
  sunday: '0',
  monday: '1',
  tuesday: '2',
  wednesday: '3',
  thursday: '4',
  friday: '5',
  saturday: '6',
};

const CRON_TO_WEEKDAY = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

const DEFAULT_DAILY_HOUR = 9;
const DEFAULT_DAILY_MINUTE = 0;
const ACTION_HINT = /\b(check|review|monitor|scan|watch|summarize|send|sync|update|run|execute|generate|prepare|analyze|audit|report|remind|draft|inspect|triage|create|build|clean|get|fetch|pull|read)\b/i;

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatTimeLabel(hour, minute) {
  const date = new Date(Date.UTC(2026, 0, 1, hour, minute));
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(date);
}

function parseTimeToken(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\./g, '');
  if (!raw) {
    return {
      hour: DEFAULT_DAILY_HOUR,
      minute: DEFAULT_DAILY_MINUTE,
      inferred: true,
    };
  }

  if (raw === 'noon') return { hour: 12, minute: 0, inferred: false };
  if (raw === 'midnight') return { hour: 0, minute: 0, inferred: false };

  const compact = raw.replace(/\s+/g, '');
  let match = compact.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2] || '0', 10);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (match[3] === 'pm' && hour !== 12) hour += 12;
    if (match[3] === 'am' && hour === 12) hour = 0;
    return { hour, minute, inferred: false };
  }

  match = compact.match(/^(\d{1,2})(?::(\d{2}))$/);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute, inferred: false };
  }

  match = compact.match(/^(\d{1,2})$/);
  if (match) {
    const hour = parseInt(match[1], 10);
    if (hour > 23) return null;
    return { hour, minute: 0, inferred: false };
  }

  return null;
}

function buildTaskTitle(actionText) {
  const cleaned = String(actionText || '')
    .replace(/^[,.:;\-\s]+/, '')
    .replace(/[?.!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Recurring task';
  const sentence = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return sentence.slice(0, 120);
}

function cleanupActionText(originalText, scheduleText) {
  let text = String(originalText || '').replace(/\s+/g, ' ').trim();

  if (scheduleText) {
    const escaped = scheduleText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'i'), ' ').trim();
  }

  text = text
    .replace(/^(please\s+)?(?:(?:can|could|would|will)\s+you\s+)/i, '')
    .replace(/^(please\s+)?(?:set\s*up|setup|schedule|create|make)\s+(?:a\s+)?(?:recurring\s+|scheduled\s+)?(?:cron\s+job|cron|job|task|reminder)?\s*(?:for\s+me\s*)?(?:to\s+)?/i, '')
    .replace(/^(please\s+)?(?:have\s+yourself|have\s+you)\s+/i, '')
    .replace(/\bfor\s+me\b/gi, ' ')
    .replace(/\bperiodically\b/gi, ' ')
    .replace(/\brecurring(?:ly)?\b/gi, ' ')
    .replace(/^[,.:;\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function hasSchedulingIntent(content) {
  const trimmed = String(content || '').trim().toLowerCase();
  return /^(?:please\s+)?(?:(?:can|could|would|will)\s+you|set\s*up|setup|schedule|create|make|run|check|review|monitor|scan|watch|summarize|send|sync|update|prepare|generate|analyze|audit|report|remind|every\b|everyday\b|daily\b|hourly\b)/.test(trimmed)
    || /\b(?:schedule|set\s*up|setup|create|make)\s+(?:a\s+)?(?:cron|recurring|scheduled)\b/.test(trimmed);
}

function buildCronDescriptor(expression, scheduleLabel, defaultedTime) {
  return {
    trigger_type: 'cron',
    trigger_cron: expression,
    schedule_label: scheduleLabel,
    defaulted_time: Boolean(defaultedTime),
  };
}

function parseEveryN(lowered) {
  const match = lowered.match(/\bevery\s+(\d{1,2})\s+(minute|minutes|hour|hours)\b/i);
  if (!match) return null;

  const interval = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (interval <= 0) return null;

  if (unit.startsWith('minute') && interval <= 59) {
    return buildCronDescriptor(
      `*/${interval} * * * *`,
      interval === 1 ? 'Every minute' : `Every ${interval} minutes`,
      false,
    );
  }

  if (unit.startsWith('hour') && interval <= 23) {
    return buildCronDescriptor(
      `0 */${interval} * * *`,
      interval === 1 ? 'Every hour' : `Every ${interval} hours`,
      false,
    );
  }

  return null;
}

function parseDailyPatterns(normalized, lowered) {
  const match = normalized.match(/\b(?:daily|every day|everyday|each day)(?:\s+at\s+([0-9:\samp\.]+|noon|midnight))?\b/i);
  if (!match) return null;
  const time = parseTimeToken(match[1]);
  if (!time) return null;
  return {
    ...buildCronDescriptor(
      `${time.minute} ${time.hour} * * *`,
      `Every day at ${formatTimeLabel(time.hour, time.minute)}`,
      time.inferred,
    ),
    matched_text: match[0],
  };
}

function parseWeekdayPattern(normalized) {
  const match = normalized.match(/\b(?:every|each)\s+weekday(?:s)?(?:\s+at\s+([0-9:\samp\.]+|noon|midnight))?\b/i);
  if (!match) return null;
  const time = parseTimeToken(match[1]);
  if (!time) return null;
  return {
    ...buildCronDescriptor(
      `${time.minute} ${time.hour} * * 1-5`,
      `Every weekday at ${formatTimeLabel(time.hour, time.minute)}`,
      time.inferred,
    ),
    matched_text: match[0],
  };
}

function parseNamedWeekdayPattern(normalized) {
  const dayNames = Object.keys(WEEKDAY_TO_CRON).join('|');
  const match = normalized.match(new RegExp(`\\b(?:every|each)\\s+(${dayNames})(?:\\s+at\\s+([0-9:\\samp\\.]+|noon|midnight))?\\b`, 'i'));
  if (!match) return null;

  const time = parseTimeToken(match[2]);
  if (!time) return null;

  const dayName = match[1].toLowerCase();
  return {
    ...buildCronDescriptor(
      `${time.minute} ${time.hour} * * ${WEEKDAY_TO_CRON[dayName]}`,
      `Every ${titleCase(dayName)} at ${formatTimeLabel(time.hour, time.minute)}`,
      time.inferred,
    ),
    matched_text: match[0],
  };
}

function parseHourlyPattern(normalized) {
  const match = normalized.match(/\b(?:hourly|every hour)\b/i);
  if (!match) return null;
  return {
    ...buildCronDescriptor('0 * * * *', 'Every hour', false),
    matched_text: match[0],
  };
}

function parseRawCronPattern(normalized) {
  const match = normalized.match(/\bcron(?:\s+job|\s+expression)?(?:\s+using)?\s+`?((?:[*\/0-9,\-]+\s+){4,5}[*\/0-9,\-]+)`?/i);
  if (!match) return null;
  const expression = match[1].trim();
  if (!cron.validate(expression)) return null;
  return {
    ...buildCronDescriptor(expression, humanizeCronExpression(expression), false),
    matched_text: match[0],
  };
}

function parsePeriodicTaskRequest(content) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim();
  if (!normalized || !hasSchedulingIntent(normalized)) return null;

  const lowered = normalized.toLowerCase();
  const parsed = parseRawCronPattern(normalized)
    || parseWeekdayPattern(normalized)
    || parseNamedWeekdayPattern(normalized)
    || parseDailyPatterns(normalized, lowered)
    || parseHourlyPattern(normalized)
    || (() => {
      const interval = parseEveryN(lowered);
      if (!interval) return null;
      return { ...interval, matched_text: lowered.match(/\bevery\s+\d{1,2}\s+(?:minute|minutes|hour|hours)\b/i)?.[0] || '' };
    })();

  if (!parsed) return null;

  const actionText = cleanupActionText(normalized, parsed.matched_text);
  if (!actionText || (!ACTION_HINT.test(actionText) && actionText.split(/\s+/).length < 3)) {
    return null;
  }

  return {
    ...parsed,
    action_text: actionText,
    title: buildTaskTitle(actionText),
  };
}

function humanizeCronExpression(expression) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) return `Cron: ${expression}`;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every hour';
  }

  const minuteStep = minute.match(/^\*\/(\d{1,2})$/);
  if (minuteStep && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const count = parseInt(minuteStep[1], 10);
    return count === 1 ? 'Every minute' : `Every ${count} minutes`;
  }

  const hourStep = hour.match(/^\*\/(\d{1,2})$/);
  if (minute === '0' && hourStep && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const count = parseInt(hourStep[1], 10);
    return count === 1 ? 'Every hour' : `Every ${count} hours`;
  }

  const hourNum = Number(hour);
  const minuteNum = Number(minute);
  const hasTime = Number.isInteger(hourNum) && Number.isInteger(minuteNum);
  const timeLabel = hasTime ? formatTimeLabel(hourNum, minuteNum) : null;

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return timeLabel ? `Every day at ${timeLabel}` : `Cron: ${expression}`;
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return timeLabel ? `Every weekday at ${timeLabel}` : 'Every weekday';
  }

  if (dayOfMonth === '*' && month === '*' && CRON_TO_WEEKDAY[dayOfWeek]) {
    return timeLabel ? `Every ${CRON_TO_WEEKDAY[dayOfWeek]} at ${timeLabel}` : `Every ${CRON_TO_WEEKDAY[dayOfWeek]}`;
  }

  return `Cron: ${expression}`;
}

module.exports = {
  DEFAULT_DAILY_HOUR,
  DEFAULT_DAILY_MINUTE,
  humanizeCronExpression,
  parsePeriodicTaskRequest,
};
