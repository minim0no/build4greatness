'use client';

import { useState } from 'react';
import type { DisasterType } from '../hooks/useSimulation';

interface AnalysisPanelProps {
  agent1Text: string;
  agent1Data: Record<string, unknown> | null;
  agent2Text: string;
  agent2Data: Record<string, unknown> | null;
  isStreaming: boolean;
  disasterType: DisasterType;
}

export default function AnalysisPanel({
  agent1Text,
  agent1Data,
  agent2Text,
  agent2Data,
  isStreaming,
  disasterType,
}: AnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<'analysis' | 'plan'>('analysis');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const hasContent = agent1Text || agent2Text;
  if (!hasContent) return null;

  const analysisLabel = disasterType === 'tornado' ? 'Tornado Analysis' : 'Flood Analysis';

  return (
    <div className="glass-panel flex flex-col max-h-full overflow-hidden">
      {/* Header with collapse toggle */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 flex-shrink-0">
        <span className="text-xs font-semibold text-white/80 uppercase tracking-wide">Results</span>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-6 h-6 flex items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Tabs */}
          <div className="flex border-b border-white/10 flex-shrink-0">
            <button
              onClick={() => setActiveTab('analysis')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === 'analysis'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {analysisLabel}
            </button>
            <button
              onClick={() => setActiveTab('plan')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === 'plan'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              Response Plan
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 text-sm text-white/80">
            {activeTab === 'analysis' && (
              <div>
                {agent1Data && (
                  <div className="mb-4 space-y-2">
                    {/* Summary */}
                    {(agent1Data as Record<string, string>).summary && (
                      <div className="bg-white/10 rounded p-3 text-white/90">
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
                            <span className="text-white/60">{zone.description}</span>
                          </div>
                        )
                      )}
                  </div>
                )}

                {/* Loading indicator while streaming */}
                {!agent1Data && agent1Text && (
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <span className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    Analyzing...
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
                        <div key={i} className="bg-white/10 rounded p-3">
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
                                    : 'bg-white/10 text-white/50'
                              }`}
                            >
                              {action.urgency?.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-white/90 text-sm font-medium">{action.action}</p>
                          <p className="text-white/40 text-xs mt-1">{action.reason}</p>
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
                          <ul className="text-xs text-white/50 mt-1 space-y-0.5">
                            {period.actions?.map((a, j) => (
                              <li key={j}>- {a}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
                )}

                {/* Loading indicator while streaming */}
                {!agent2Data && agent2Text && (
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <span className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    Generating plan...
                  </div>
                )}

                {!agent2Text && !agent2Data && (
                  <p className="text-white/40 italic text-xs">
                    Response plan will appear after analysis completes...
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
