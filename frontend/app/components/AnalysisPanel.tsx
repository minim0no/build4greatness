'use client';

import { useState } from 'react';

interface AnalysisPanelProps {
  agent1Text: string;
  agent1Data: Record<string, unknown> | null;
  agent2Text: string;
  agent2Data: Record<string, unknown> | null;
  isStreaming: boolean;
}

export default function AnalysisPanel({
  agent1Text,
  agent1Data,
  agent2Text,
  agent2Data,
  isStreaming,
}: AnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<'analysis' | 'plan'>('analysis');

  const hasContent = agent1Text || agent2Text;
  if (!hasContent) return null;

  return (
    <div className="flex flex-col border-t border-zinc-700 flex-1 min-h-0">
      {/* Tabs */}
      <div className="flex border-b border-zinc-700 flex-shrink-0">
        <button
          onClick={() => setActiveTab('analysis')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'analysis'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Flood Analysis
        </button>
        <button
          onClick={() => setActiveTab('plan')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'plan'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Response Plan
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 text-sm text-zinc-300">
        {activeTab === 'analysis' && (
          <div>
            {agent1Data && (
              <div className="mb-4 space-y-2">
                {/* Summary */}
                {(agent1Data as Record<string, string>).summary && (
                  <div className="bg-zinc-800 rounded p-3 text-zinc-200">
                    {(agent1Data as Record<string, string>).summary}
                  </div>
                )}

                {/* Risk zones */}
                {Array.isArray((agent1Data as Record<string, unknown[]>).risk_zones) &&
                  ((agent1Data as Record<string, unknown[]>).risk_zones as Array<{ level: string; description: string }>).map(
                    (zone, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                            zone.level === 'high'
                              ? 'bg-red-900/50 text-red-300'
                              : zone.level === 'medium'
                                ? 'bg-yellow-900/50 text-yellow-300'
                                : 'bg-green-900/50 text-green-300'
                          }`}
                        >
                          {zone.level}
                        </span>
                        <span className="text-zinc-400">{zone.description}</span>
                      </div>
                    )
                  )}
              </div>
            )}

            {/* Streaming text */}
            {!agent1Data && agent1Text && (
              <div className="whitespace-pre-wrap font-mono text-xs text-zinc-400">
                {agent1Text}
                {isStreaming && <span className="animate-pulse">|</span>}
              </div>
            )}
          </div>
        )}

        {activeTab === 'plan' && (
          <div>
            {agent2Data && (
              <div className="space-y-3">
                {/* Priority actions */}
                {Array.isArray((agent2Data as Record<string, unknown[]>).priority_actions) &&
                  ((agent2Data as Record<string, unknown[]>).priority_actions as Array<{
                    rank: number;
                    action: string;
                    reason: string;
                    urgency: string;
                  }>).map((action, i) => (
                    <div key={i} className="bg-zinc-800 rounded p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                          {action.rank}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            action.urgency === 'immediate'
                              ? 'bg-red-900/50 text-red-300'
                              : action.urgency === 'within_1hr'
                                ? 'bg-yellow-900/50 text-yellow-300'
                                : 'bg-zinc-700 text-zinc-400'
                          }`}
                        >
                          {action.urgency?.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-zinc-200 text-sm font-medium">{action.action}</p>
                      <p className="text-zinc-500 text-xs mt-1">{action.reason}</p>
                    </div>
                  ))}

                {/* Timeline */}
                {Array.isArray((agent2Data as Record<string, unknown[]>).action_timeline) &&
                  ((agent2Data as Record<string, unknown[]>).action_timeline as Array<{
                    timeframe: string;
                    actions: string[];
                  }>).map((period, i) => (
                    <div key={i} className="border-l-2 border-blue-600 pl-3">
                      <p className="text-xs font-semibold text-blue-400">{period.timeframe}</p>
                      <ul className="text-xs text-zinc-400 mt-1 space-y-0.5">
                        {period.actions?.map((a, j) => (
                          <li key={j}>- {a}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}

            {/* Streaming text */}
            {!agent2Data && agent2Text && (
              <div className="whitespace-pre-wrap font-mono text-xs text-zinc-400">
                {agent2Text}
                {isStreaming && <span className="animate-pulse">|</span>}
              </div>
            )}

            {!agent2Text && !agent2Data && (
              <p className="text-zinc-500 italic text-xs">
                Response plan will appear after flood analysis completes...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
