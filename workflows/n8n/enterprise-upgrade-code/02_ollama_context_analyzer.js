const event = $input.first().json || {};
const enabled = String($env.LOCAL_LLM_ENABLED || 'false').toLowerCase() === 'true';
const baseUrl = ($env.LOCAL_LLM_URL || 'http://ollama:11434').replace(/\/$/, '');
const model = $env.LOCAL_LLM_MODEL || 'llama3.2';

if (!enabled) {
  return [{
    json: {
      ...event,
      llm_analysis: {
        skipped: true,
        reason: 'LOCAL_LLM_DISABLED',
        provider: 'ollama'
      }
    }
  }];
}

try {
  const response = await $http.request({
    method: 'POST',
    url: `${baseUrl}/api/chat`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0.1 },
      messages: [
        {
          role: 'system',
          content: [
            'You summarize elevator incidents for a SCADA operator.',
            'Return JSON only with keys: explanation, maintenance_recommendation, incident_summary, confidence.',
            'Do not authorize commands. Do not change risk scores.'
          ].join(' ')
        },
        {
          role: 'user',
          content: JSON.stringify({
            thing_id: event.thing_id,
            risk_analysis: event.risk_analysis,
            payload: event.payload,
            behavior_timeline: (event.behavior_timeline || []).slice(-20)
          })
        }
      ]
    }),
    timeout: 8000
  });

  const content = response.message?.content || response.response || '{}';
  const parsed = JSON.parse(content);
  return [{
    json: {
      ...event,
      llm_analysis: {
        provider: 'ollama',
        model,
        skipped: false,
        explanation: parsed.explanation || '',
        maintenance_recommendation: parsed.maintenance_recommendation || '',
        incident_summary: parsed.incident_summary || '',
        confidence: Number(parsed.confidence || 0)
      }
    }
  }];
} catch (error) {
  return [{
    json: {
      ...event,
      llm_analysis: {
        provider: 'ollama',
        model,
        skipped: true,
        reason: 'LOCAL_LLM_ERROR',
        detail: error.message || 'Unknown Ollama failure'
      }
    }
  }];
}

