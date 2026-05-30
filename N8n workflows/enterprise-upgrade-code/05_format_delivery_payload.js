const row = $input.first().json || {};
const env = (typeof process !== 'undefined' && process.env)
  ? process.env
  : (typeof $env !== 'undefined' ? $env : {});

const envValue = (key, fallback = '') => {
  const value = env[key];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
};

const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
const detailed = payload.detailed || {};
const flags = detailed.flags || [];
const riskScore = detailed.risk_score || 0;
const correlationId = row.correlation_id || detailed.correlation_id || '';
const title = payload.title || `${row.severity} elevator alert`;
const compact = payload.compact || `Elevator ${row.thing_id}`;
const dashboardUrl = payload.dashboard_url || envValue('DASHBOARD_URL');

const text = [
  `${title}`,
  `Elevator: ${row.thing_id}`,
  `Severity: ${row.severity}`,
  `Risk: ${riskScore}`,
  `Correlation: ${correlationId}`,
  compact,
  flags.length ? `Flags: ${flags.join(', ')}` : null,
  dashboardUrl ? `Dashboard: ${dashboardUrl}` : null
].filter(Boolean).join('\n');

const html = `
<h2>${title}</h2>
<p><strong>Elevator:</strong> ${row.thing_id}</p>
<p><strong>Severity:</strong> ${row.severity}</p>
<p><strong>Risk:</strong> ${riskScore}</p>
<p><strong>Correlation:</strong> ${correlationId}</p>
<p>${compact}</p>
<p><strong>Flags:</strong> ${flags.join(', ') || 'None'}</p>
${dashboardUrl ? `<p><a href="${dashboardUrl}">Open dashboard incident</a></p>` : ''}
`;

return [{
  json: {
    ...row,
    payload,
    delivery: {
      telegramChatId: envValue('TELEGRAM_CHAT_ID'),
      emailFrom: envValue('EMAIL_FROM', 'elevator-alerts@localhost'),
      emailTo: envValue('EMAIL_TO'),
      smsWebhookUrl: envValue('SMS_WEBHOOK_URL'),
      voiceWebhookUrl: envValue('VOICE_WEBHOOK_URL'),
      alertPhone: envValue('ALERT_PHONE')
    },
    formatted: {
      telegram: text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1'),
      emailSubject: `[${row.severity}] ${row.thing_id} ${correlationId}`,
      emailHtml: html,
      sms: `[${row.severity}] ${row.thing_id} risk ${riskScore}. ${compact}`.slice(0, 280),
      voice: `${row.severity} elevator incident for ${row.thing_id}. Correlation ${correlationId}. ${compact}`
    }
  }
}];
