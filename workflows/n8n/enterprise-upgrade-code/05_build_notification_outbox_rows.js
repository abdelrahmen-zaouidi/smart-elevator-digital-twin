const rawInput = $input.first().json || {};
const input = rawInput.body && typeof rawInput.body === 'object' ? rawInput.body : rawInput;
const env = (typeof process !== 'undefined' && process.env)
  ? process.env
  : (typeof $env !== 'undefined' ? $env : {});

const envValue = (key, fallback = '') => {
  const value = env[key];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
};

const envFlag = (key) => envValue(key, 'false').toLowerCase() === 'true';
const hasValue = (key) => envValue(key).trim().length > 0;
const uniqueChannels = (value) => {
  const channels = Array.isArray(value) ? value : [value];
  return [...new Set(channels
    .filter((channel) => typeof channel === 'string' && channel.trim())
    .map((channel) => channel.trim().toLowerCase()))];
};

const severity = input.severity || input.risk_analysis?.severity || input.event?.risk_analysis?.severity || 'INFO';
const thingId = input.thing_id || input.event?.thing_id || input.work_order?.thing_id || envValue('PRIMARY_THING_ID', 'building:floor1:elevator');
const correlationId = input.correlation_id || input.event?.correlation_id || input.work_order?.correlation_id || `CID-NOTIFY-${Date.now()}`;
const eventType = input.event_type || input.event?.event_type || (input.work_order ? 'MAINTENANCE_REQUIRED' : 'NOTIFICATION_REQUEST');
const dedupeMinutes = Number(envValue('NOTIFICATION_DEDUPE_MINUTES', '5'));
const bucket = Math.floor(Date.now() / (dedupeMinutes * 60 * 1000));
const dashboardUrl = envValue('DASHBOARD_URL', 'http://localhost:3000');

const enabled = {
  telegram: envFlag('TELEGRAM_ENABLED') && hasValue('TELEGRAM_CHAT_ID'),
  email: envFlag('EMAIL_ENABLED') && hasValue('EMAIL_TO'),
  sms: envFlag('SMS_ENABLED') && hasValue('SMS_WEBHOOK_URL') && hasValue('ALERT_PHONE'),
  voice: envFlag('VOICE_ENABLED') && hasValue('VOICE_WEBHOOK_URL') && hasValue('ALERT_PHONE')
};

const severityChannels = {
  OK: ['dashboard'],
  INFO: ['dashboard'],
  WARNING: ['dashboard', 'telegram', 'email'],
  CRITICAL: ['dashboard', 'telegram', 'email', 'sms'],
  LOCKDOWN: ['dashboard', 'telegram', 'email', 'sms', 'voice']
};

const normalizedSeverity = severity === 'LOCKDOWN' ? 'LOCKDOWN' : severity;
const requestedChannels = uniqueChannels(input.channels || severityChannels[normalizedSeverity] || ['dashboard']);
const skippedChannels = requestedChannels
  .filter((channel) => channel !== 'dashboard' && !enabled[channel])
  .map((channel) => ({
    channel,
    reason: 'disabled_or_missing_channel_configuration'
  }));

let channels = requestedChannels;
channels = channels.filter((channel) => channel === 'dashboard' || enabled[channel]);

if (channels.length === 0) {
  channels = ['dashboard'];
}

const riskScore = input.risk_analysis?.risk_score || input.event?.risk_analysis?.risk_score || input.event?.risk_score || 0;
const flags = input.risk_analysis?.flags || input.event?.risk_analysis?.flags || [];
const title = input.title || `${normalizedSeverity} elevator alert`;
const compact = input.message || (input.work_order
  ? `Work order ${input.work_order.work_order_id} priority ${input.work_order.priority}`
  : `Risk ${riskScore}; flags ${flags.join(', ') || 'none'}`);

const priority = normalizedSeverity === 'CRITICAL' || normalizedSeverity === 'LOCKDOWN'
  ? 'CRITICAL'
  : normalizedSeverity === 'WARNING'
    ? 'HIGH'
    : 'LOW';

return channels.map((channel) => {
  // Dashboard rows are already visible once persisted; external channels are
  // queued for the scheduled delivery drain.
  const status = channel === 'dashboard' ? 'SENT' : 'PENDING';

  return {
    json: {
      correlation_id: correlationId,
      thing_id: thingId,
      severity: normalizedSeverity,
      priority,
      channel,
      status,
      dedupe_key: `${thingId}:${eventType}:${normalizedSeverity}:${channel}:${bucket}`,
      payload: {
        title,
        compact,
        detailed: {
          thing_id: thingId,
          severity: normalizedSeverity,
          risk_score: riskScore,
          flags,
          event_type: eventType,
          correlation_id: correlationId,
          notification_channels: {
            requested: requestedChannels,
            selected: channels,
            skipped: skippedChannels
          },
          event: input.event || input,
          work_order: input.work_order || null
        },
        dashboard_url: `${dashboardUrl.replace(/\/$/, '')}?thing_id=${encodeURIComponent(thingId)}&correlation_id=${encodeURIComponent(correlationId)}`
      },
      max_attempts: normalizedSeverity === 'CRITICAL' || normalizedSeverity === 'LOCKDOWN' ? 8 : 5
    }
  };
});
