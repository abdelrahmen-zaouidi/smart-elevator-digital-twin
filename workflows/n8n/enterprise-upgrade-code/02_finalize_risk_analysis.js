const event = $input.first().json || {};
const analysis = event.risk_analysis || {};
const llm = event.llm_analysis || { skipped: true, reason: 'NOT_RUN' };

const explanation = llm.skipped
  ? analysis.explanation || 'Deterministic local analysis completed.'
  : llm.explanation || analysis.explanation || 'Deterministic local analysis completed with local LLM summary.';

return [{
  json: {
    ...event,
    risk_score: analysis.risk_score || event.risk_score || 0,
    severity: analysis.severity || event.severity || 'OK',
    risk_analysis: {
      risk_score: analysis.risk_score || 0,
      severity: analysis.severity || 'OK',
      flags: analysis.flags || [],
      breakdown: analysis.breakdown || {},
      action_required: !!analysis.action_required,
      requires_human_review: !!analysis.requires_human_review,
      triggered_action: analysis.triggered_action || { agent: 'none', command: '', priority: 'LOW', reason: [], target_floor: null },
      explanation,
      local_llm_summary: llm.skipped ? null : {
        provider: llm.provider,
        model: llm.model,
        incident_summary: llm.incident_summary || '',
        maintenance_recommendation: llm.maintenance_recommendation || '',
        confidence: Number(llm.confidence || 0)
      },
      analyzed_at: new Date().toISOString()
    },
    metadata: {
      ...(event.metadata || {}),
      workflow: '02_analysis_ai_brain_agent',
      node: 'Finalize Risk Analysis',
      schema_version: '1.0'
    }
  }
}];

