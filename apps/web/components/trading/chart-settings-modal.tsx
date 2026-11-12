'use client';

import React, { useState, useEffect } from 'react';
import { playTradingSound, type SoundEffectType } from '@/lib/trading/audio-synthesizer';

export interface ChartSettingsState {
  // Category A: Show on chart
  showSignals: boolean;
  showHmrPeriods: boolean;
  showPriceAlerts: boolean;
  showOpenPositions: boolean;
  showTakeProfit: boolean;
  showStopLoss: boolean;
  showStopOrders: boolean;
  showLimitOrders: boolean;
  orderPositionAlignment: 'Left' | 'Right' | 'Auto';
  showEconomicCalendar: boolean;
  economicImpact: {
    high: boolean;
    middle: boolean;
    low: boolean;
    lowest: boolean;
  };

  // Category B: Sound effects
  soundsEnabled: boolean;
  masterVolume: number;
  soundEffects: Record<SoundEffectType, boolean>;

  // Category C: Trading settings
  autoTpSlMode: 'Disabled' | 'Fixed price' | 'Pips' | 'Percentage' | 'Money amount' | 'Risk/reward ratio';
  defaultTpPips: number;
  defaultSlPips: number;
  defaultTpSlUnits: 'Price' | 'Pips' | 'Money' | 'Percentage';
  defaultLotSize: number;
  defaultLeverage: number;
  defaultOrderType: 'Market' | 'Limit' | 'Stop';
  oneClickTrading: boolean;
  orderConfirmation: boolean;
  trailingStopEnabled: boolean;
  trailingStopPips: number;
  riskPercentage: number;

  // Category D: Open order mode
  openOrderMode: 'Regular form' | 'Quick trading form' | 'One-click form' | 'Confirmation form';

  // Category E: Price source
  priceSource: 'Bid' | 'Ask' | 'Last traded price' | 'Mark price' | 'Index price' | 'Mid price';

  // Category F: Timezone
  timezone: string; // e.g. 'UTC', 'Asia/Dhaka', 'Europe/London', etc.

  // Category G: Chart appearance
  backgroundColor: string;
  bullishCandleColor: string;
  bearishCandleColor: string;
  wickColor: string;
  borderColor: string;
  gridVisibility: boolean;
  gridColor: string;
  crosshairColor: string;
  textColor: string;
  fontSize: number;
  candleSpacingRatio: number;
  showSessionSeparators: boolean;

  // Category H: Price and scale settings
  autoScale: boolean;
  lockScale: boolean;
  reverseScale: boolean;
  logarithmicScale: boolean;
  percentageScale: boolean;
  pricePrecision: number;
  showBidAskLines: boolean;
  showCurrentPriceLine: boolean;
  showPreviousCloseLine: boolean;

  // Category I: Trading visualization
  showEntryLines: boolean;
  showAvgEntryPrice: boolean;
  showPendingLines: boolean;
  showExecutionMarkers: boolean;
  showPositionLabels: boolean;
  showPnlLabels: boolean;

  // Category J: General chart behavior
  scrollToLoadHistory: boolean;
  autoScrollToLatest: boolean;
  keepDrawingsVisible: boolean;
  rememberSettings: boolean;

  // Part 5: Long-press tooltip settings
  longPressTooltipEnabled: boolean;
  longPressDurationMs: number;
}

export const DEFAULT_CHART_SETTINGS: ChartSettingsState = {
  showSignals: true,
  showHmrPeriods: false,
  showPriceAlerts: true,
  showOpenPositions: true,
  showTakeProfit: true,
  showStopLoss: true,
  showStopOrders: true,
  showLimitOrders: true,
  orderPositionAlignment: 'Right',
  showEconomicCalendar: true,
  economicImpact: {
    high: true,
    middle: true,
    low: false,
    lowest: false,
  },
  soundsEnabled: true,
  masterVolume: 0.7,
  soundEffects: {
    orderExecution: true,
    orderRejection: true,
    takeProfit: true,
    stopLoss: true,
    stopOut: true,
    pendingOrderActivation: true,
    priceAlert: true,
    marginWarning: true,
    connectionLost: true,
    connectionRestored: true,
  },
  autoTpSlMode: 'Disabled',
  defaultTpPips: 50,
  defaultSlPips: 30,
  defaultTpSlUnits: 'Pips',
  defaultLotSize: 1.0,
  defaultLeverage: 100,
  defaultOrderType: 'Market',
  oneClickTrading: false,
  orderConfirmation: true,
  trailingStopEnabled: false,
  trailingStopPips: 20,
  riskPercentage: 2.0,
  openOrderMode: 'Regular form',
  priceSource: 'Mid price',
  timezone: 'UTC',
  backgroundColor: '#0c1017',
  bullishCandleColor: '#2962FF', // Exness vibrant blue as in screenshot 1-10
  bearishCandleColor: '#f23645', // Exness bright red
  wickColor: '#94a3b8',
  borderColor: '#334155',
  gridVisibility: true,
  gridColor: '#1e293b',
  crosshairColor: '#cbd5e1',
  textColor: '#94a3b8',
  fontSize: 11,
  candleSpacingRatio: 0.75,
  showSessionSeparators: false,
  autoScale: true,
  lockScale: false,
  reverseScale: false,
  logarithmicScale: false,
  percentageScale: false,
  pricePrecision: 2,
  showBidAskLines: true,
  showCurrentPriceLine: true,
  showPreviousCloseLine: false,
  showEntryLines: true,
  showAvgEntryPrice: true,
  showPendingLines: true,
  showExecutionMarkers: true,
  showPositionLabels: true,
  showPnlLabels: true,
  scrollToLoadHistory: true,
  autoScrollToLatest: true,
  keepDrawingsVisible: true,
  rememberSettings: true,
  longPressTooltipEnabled: true,
  longPressDurationMs: 400,
};

export const COMMON_TIMEZONES = [
  { value: 'UTC', label: 'UTC (Universal Coordinated Time)' },
  { value: 'Asia/Dhaka', label: 'Asia/Dhaka (GMT+6)' },
  { value: 'Europe/London', label: 'Europe/London (GMT+0/+1)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST, GMT+9)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT, GMT+8)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST, GMT+4)' },
  { value: 'Europe/Frankfurt', label: 'Europe/Frankfurt (CET/CEST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
];

interface ChartSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ChartSettingsState;
  onSave: (newSettings: ChartSettingsState) => void;
}

export function ChartSettingsModal({
  isOpen,
  onClose,
  settings: initialSettings,
  onSave,
}: ChartSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<
    | 'show'
    | 'sound'
    | 'trading'
    | 'orderMode'
    | 'priceSource'
    | 'timezone'
    | 'appearance'
    | 'scales'
    | 'visualization'
    | 'general'
  >('show');

  const [localSettings, setLocalSettings] = useState<ChartSettingsState>(initialSettings);
  const [searchQuery, setSearchQuery] = useState('');
  const [tzSearch, setTzSearch] = useState('');

  useEffect(() => {
    setLocalSettings(initialSettings);
  }, [initialSettings, isOpen]);

  if (!isOpen) return null;

  const handleToggle = (key: keyof ChartSettingsState) => {
    setLocalSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSaveAndClose = () => {
    onSave(localSettings);
    onClose();
  };

  const categories = [
    { id: 'show', label: 'Show on Chart', icon: '👁️' },
    { id: 'sound', label: 'Sound Effects', icon: '🔔' },
    { id: 'trading', label: 'Trading Settings', icon: '⚡' },
    { id: 'orderMode', label: 'Open Order Mode', icon: '📝' },
    { id: 'priceSource', label: 'Price Source', icon: '💲' },
    { id: 'timezone', label: 'Time Zone', icon: '🌐' },
    { id: 'appearance', label: 'Appearance', icon: '🎨' },
    { id: 'scales', label: 'Price & Scales', icon: '📐' },
    { id: 'visualization', label: 'Trading Vis.', icon: '📊' },
    { id: 'general', label: 'General Behavior', icon: '⚙️' },
  ];

  const filteredCategories = searchQuery
    ? categories.filter((c) => c.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : categories;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl h-[640px] bg-ink-950 border border-ink-700 rounded-xl shadow-2xl flex flex-col overflow-hidden text-white animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="h-14 px-5 border-b border-ink-800 flex items-center justify-between shrink-0 bg-ink-900/60">
          <div className="flex items-center gap-3">
            <span className="text-amber-400 font-bold text-base tracking-wide flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              Chart & Terminal Settings
            </span>
            <span className="text-xs text-slate-400 bg-ink-800 px-2 py-0.5 rounded border border-ink-700">
              Exness v2.4
            </span>
          </div>

          {/* Search bar inside settings */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder="Search settings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 h-8 bg-ink-950 border border-ink-700 rounded-lg pl-8 pr-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
              <span className="absolute left-2.5 top-2 text-xs text-slate-500">🔍</span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-ink-800 hover:bg-ink-700 flex items-center justify-center text-slate-400 hover:text-white transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body: Left Categories + Right Controls */}
        <div className="flex-1 flex min-h-0">
          {/* Categories Sidebar */}
          <div className="w-56 border-r border-ink-800 bg-ink-900/40 p-2 overflow-y-auto space-y-1 shrink-0">
            {filteredCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveTab(cat.id as any)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition text-left ${
                  activeTab === cat.id
                    ? 'bg-amber-400 text-ink-950 font-bold shadow'
                    : 'text-slate-300 hover:bg-ink-800/80 hover:text-white'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>

          {/* Settings Tab Content */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6 text-sm text-slate-200">
            
            {/* CATEGORY A: SHOW ON CHART */}
            {activeTab === 'show' && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-bold text-white text-base">Show on Chart</h3>
                  <p className="text-xs text-slate-400">Configure visual objects and market signals rendered directly over candles.</p>
                </div>

                <div className="space-y-3">
                  {[
                    { key: 'showSignals', label: 'Signals', desc: 'Display algorithmic buy and sell signal indicators.' },
                    { key: 'showHmrPeriods', label: 'HMR periods', desc: 'Highlight High Margin Requirement sessions (requires verified broker feed).' },
                    { key: 'showPriceAlerts', label: 'Price alerts', desc: 'Display horizontal price alert guide lines.' },
                    { key: 'showOpenPositions', label: 'Open positions', desc: 'Display entry lines and running P&L tags for active trades.' },
                    { key: 'showTakeProfit', label: 'Take Profit', desc: 'Render green dashed TP trigger lines on chart.' },
                    { key: 'showStopLoss', label: 'Stop Loss', desc: 'Render red dashed SL trigger lines on chart.' },
                    { key: 'showStopOrders', label: 'Stop orders', desc: 'Show pending Buy Stop / Sell Stop order markers.' },
                    { key: 'showLimitOrders', label: 'Limit orders', desc: 'Show pending Buy Limit / Sell Limit order markers.' },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between p-2.5 rounded-lg bg-ink-900/50 border border-ink-800">
                      <div>
                        <div className="font-semibold text-white text-xs">{item.label}</div>
                        <div className="text-[11px] text-slate-400">{item.desc}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggle(item.key as any)}
                        className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                          (localSettings as any)[item.key] ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                            (localSettings as any)[item.key] ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Alignment */}
                <div className="p-3 rounded-lg bg-ink-900/50 border border-ink-800 space-y-2">
                  <span className="text-xs font-semibold text-white">Order and position alignment</span>
                  <div className="flex gap-2">
                    {(['Right', 'Left', 'Auto'] as const).map((align) => (
                      <button
                        key={align}
                        onClick={() => setLocalSettings((p) => ({ ...p, orderPositionAlignment: align }))}
                        className={`px-3 py-1.5 rounded text-xs font-bold border transition ${
                          localSettings.orderPositionAlignment === align
                            ? 'bg-amber-400 text-ink-950 border-amber-400'
                            : 'bg-ink-950 text-slate-300 border-ink-700 hover:border-slate-500'
                        }`}
                      >
                        {align}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Economic Calendar Filters */}
                <div className="p-3 rounded-lg bg-ink-900/50 border border-ink-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-white">Economic Calendar</div>
                      <div className="text-[11px] text-slate-400">Display upcoming macro events on the time axis.</div>
                    </div>
                    <button
                      onClick={() => handleToggle('showEconomicCalendar')}
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        localSettings.showEconomicCalendar ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${localSettings.showEconomicCalendar ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {localSettings.showEconomicCalendar && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-ink-800 text-xs">
                      {[
                        { key: 'high', label: 'High impact (🔴)', color: 'text-red-400' },
                        { key: 'middle', label: 'Middle impact (🟠)', color: 'text-amber-400' },
                        { key: 'low', label: 'Low impact (🟡)', color: 'text-yellow-400' },
                        { key: 'lowest', label: 'Lowest impact (⚪)', color: 'text-slate-400' },
                      ].map((imp) => (
                        <label key={imp.key} className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-ink-800">
                          <input
                            type="checkbox"
                            checked={localSettings.economicImpact[imp.key as keyof typeof localSettings.economicImpact]}
                            onChange={(e) =>
                              setLocalSettings((p) => ({
                                ...p,
                                economicImpact: {
                                  ...p.economicImpact,
                                  [imp.key]: e.target.checked,
                                },
                              }))
                            }
                            className="rounded border-ink-700 text-amber-400 focus:ring-0"
                          />
                          <span className={imp.color}>{imp.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CATEGORY B: SOUND EFFECTS */}
            {activeTab === 'sound' && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-bold text-white text-base">Sound Effects</h3>
                  <p className="text-xs text-slate-400">Audio feedback synthesized via Web Audio API. Zero external audio downloads.</p>
                </div>

                {/* Master Volume & Toggle */}
                <div className="p-4 rounded-lg bg-ink-900/60 border border-ink-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-xs">Master Audio</span>
                    <button
                      onClick={() => handleToggle('soundsEnabled')}
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        localSettings.soundsEnabled ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${localSettings.soundsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {localSettings.soundsEnabled && (
                    <div className="flex items-center gap-4 pt-2">
                      <span className="text-xs text-slate-300">Volume: {Math.round(localSettings.masterVolume * 100)}%</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={localSettings.masterVolume}
                        onChange={(e) => setLocalSettings((p) => ({ ...p, masterVolume: parseFloat(e.target.value) }))}
                        className="flex-1 accent-amber-400 cursor-pointer"
                      />
                    </div>
                  )}
                </div>

                {/* Sound Events List */}
                <div className="space-y-2">
                  {[
                    { type: 'orderExecution', label: 'Order Execution' },
                    { type: 'orderRejection', label: 'Order Rejection' },
                    { type: 'takeProfit', label: 'Closing by Take Profit' },
                    { type: 'stopLoss', label: 'Closing by Stop Loss' },
                    { type: 'stopOut', label: 'Closing by Stop Out' },
                    { type: 'pendingOrderActivation', label: 'Pending Order Activation' },
                    { type: 'priceAlert', label: 'Price Alerts' },
                    { type: 'marginWarning', label: 'Margin Warning' },
                    { type: 'connectionLost', label: 'Connection Lost' },
                    { type: 'connectionRestored', label: 'Connection Restored' },
                  ].map((s) => (
                    <div key={s.type} className="flex items-center justify-between p-2 rounded-lg bg-ink-900/40 border border-ink-800">
                      <span className="text-xs text-slate-200">{s.label}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => playTradingSound(s.type as SoundEffectType, {
                            enabled: true,
                            masterVolume: localSettings.masterVolume,
                            effects: { [s.type]: true } as any,
                          })}
                          className="px-2 py-0.5 rounded text-[10px] bg-ink-800 hover:bg-ink-700 text-amber-300 border border-ink-700"
                        >
                          ▶ Preview
                        </button>
                        <input
                          type="checkbox"
                          checked={localSettings.soundEffects[s.type as SoundEffectType]}
                          onChange={(e) =>
                            setLocalSettings((p) => ({
                              ...p,
                              soundEffects: {
                                ...p.soundEffects,
                                [s.type]: e.target.checked,
                              },
                            }))
                          }
                          className="rounded border-ink-700 text-amber-400 focus:ring-0"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CATEGORY C: TRADING SETTINGS */}
            {activeTab === 'trading' && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-bold text-white text-base">Trading Settings</h3>
                  <p className="text-xs text-slate-400">Order execution defaults, automatic TP/SL calculation, and risk controls.</p>
                </div>

                {/* Auto TP/SL */}
                <div className="p-4 rounded-lg bg-ink-900/50 border border-ink-800 space-y-3">
                  <div className="text-xs font-semibold text-white">Set TP/SL automatically</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      'Disabled',
                      'Fixed price',
                      'Pips',
                      'Percentage',
                      'Money amount',
                      'Risk/reward ratio',
                    ].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setLocalSettings((p) => ({ ...p, autoTpSlMode: mode as any }))}
                        className={`p-2 rounded text-xs font-medium border text-center transition ${
                          localSettings.autoTpSlMode === mode
                            ? 'bg-amber-400 text-ink-950 border-amber-400 font-bold'
                            : 'bg-ink-950 text-slate-300 border-ink-700 hover:border-slate-500'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>

                  {localSettings.autoTpSlMode !== 'Disabled' && (
                    <div className="grid grid-cols-2 gap-4 pt-3 border-t border-ink-800 text-xs">
                      <div>
                        <span className="text-slate-400">Default Take Profit ({localSettings.defaultTpSlUnits}):</span>
                        <input
                          type="number"
                          value={localSettings.defaultTpPips}
                          onChange={(e) => setLocalSettings((p) => ({ ...p, defaultTpPips: parseFloat(e.target.value) || 0 }))}
                          className="w-full mt-1 h-8 bg-ink-950 border border-ink-700 rounded px-2 text-white"
                        />
                      </div>
                      <div>
                        <span className="text-slate-400">Default Stop Loss ({localSettings.defaultTpSlUnits}):</span>
                        <input
                          type="number"
                          value={localSettings.defaultSlPips}
                          onChange={(e) => setLocalSettings((p) => ({ ...p, defaultSlPips: parseFloat(e.target.value) || 0 }))}
                          className="w-full mt-1 h-8 bg-ink-950 border border-ink-700 rounded px-2 text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Defaults */}
                <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-ink-900/50 border border-ink-800 text-xs">
                  <div>
                    <span className="text-slate-400">Default Lot Size:</span>
                    <input
                      type="number"
                      step="0.01"
                      value={localSettings.defaultLotSize}
                      onChange={(e) => setLocalSettings((p) => ({ ...p, defaultLotSize: parseFloat(e.target.value) || 0.01 }))}
                      className="w-full mt-1 h-8 bg-ink-950 border border-ink-700 rounded px-2 text-white"
                    />
                  </div>
                  <div>
                    <span className="text-slate-400">Default Leverage:</span>
                    <input
                      type="number"
                      value={localSettings.defaultLeverage}
                      onChange={(e) => setLocalSettings((p) => ({ ...p, defaultLeverage: parseInt(e.target.value) || 100 }))}
                      className="w-full mt-1 h-8 bg-ink-950 border border-ink-700 rounded px-2 text-white"
                    />
                  </div>
                </div>

                {/* 1-Click & Confirmation */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-ink-900/50 border border-ink-800">
                    <div>
                      <div className="text-xs font-semibold text-white">One-Click Trading</div>
                      <div className="text-[11px] text-slate-400">Submit market orders immediately without confirmation dialog.</div>
                    </div>
                    <button
                      onClick={() => handleToggle('oneClickTrading')}
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        localSettings.oneClickTrading ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${localSettings.oneClickTrading ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* CATEGORY D: OPEN ORDER MODE */}
            {activeTab === 'orderMode' && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-bold text-white text-base">Open Order Mode</h3>
                  <p className="text-xs text-slate-400">Select standard or streamlined order entry forms.</p>
                </div>

                <div className="space-y-3">
                  {[
                    { mode: 'Regular form', desc: 'Standard Exness dual-panel form with full SL/TP, pip calculators, and margin previews.' },
                    { mode: 'Quick trading form', desc: 'Compact instant buy/sell form directly embedded above the chart.' },
                    { mode: 'One-click form', desc: 'Instant executions with pre-configured volume lot sizes.' },
                    { mode: 'Confirmation form', desc: 'Always requests modal review with risk analysis before order transmission.' },
                  ].map((m) => (
                    <div
                      key={m.mode}
                      onClick={() => setLocalSettings((p) => ({ ...p, openOrderMode: m.mode as any }))}
                      className={`p-3 rounded-lg border cursor-pointer transition ${
                        localSettings.openOrderMode === m.mode
                          ? 'bg-amber-400/10 border-amber-400 text-white'
                          : 'bg-ink-900/40 border-ink-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center justify-between">
                        <span>{m.mode}</span>
                        {localSettings.openOrderMode === m.mode && <span className="text-amber-400">✓ Active</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">{m.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CATEGORY E: PRICE SOURCE */}
            {activeTab === 'priceSource' && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-bold text-white text-base">Price Source</h3>
                  <p className="text-xs text-slate-400">Select which market data stream governs chart candles and order triggers.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { source: 'Mid price', desc: '(Bid + Ask) / 2. Standard institutional charting reference.' },
                    { source: 'Bid', desc: 'Highest price a buyer is willing to pay. Chart reflects sell exit prices.' },
                    { source: 'Ask', desc: 'Lowest price a seller is willing to accept. Chart reflects buy entry prices.' },
                    { source: 'Last traded price', desc: 'Actual matched transaction price from the live exchange stream.' },
                    { source: 'Mark price', desc: 'Fair value index used for crypto margin and liquidation calculations.' },
                  ].map((ps) => (
                    <div
                      key={ps.source}
                      onClick={() => setLocalSettings((p) => ({ ...p, priceSource: ps.source as any }))}
                      className={`p-3 rounded-lg border cursor-pointer transition ${
                        localSettings.priceSource === ps.source
                          ? 'bg-amber-400/10 border-amber-400 text-white'
                          : 'bg-ink-900/40 border-ink-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center justify-between">
                        <span>{ps.source}</span>
                        {localSettings.priceSource === ps.source && <span className="text-amber-400">✓ Active</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">{ps.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CATEGORY F: TIMEZONE */}
            {activeTab === 'timezone' && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-bold text-white text-base">Time Zone</h3>
                  <p className="text-xs text-slate-400">All chart timestamps and economic events convert strictly for presentation.</p>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search IANA timezone (e.g. Dhaka, London, Tokyo, UTC)..."
                    value={tzSearch}
                    onChange={(e) => setTzSearch(e.target.value)}
                    className="w-full h-9 bg-ink-950 border border-ink-700 rounded-lg px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {COMMON_TIMEZONES.filter((tz) =>
                    tz.label.toLowerCase().includes(tzSearch.toLowerCase()) || tz.value.toLowerCase().includes(tzSearch.toLowerCase())
                  ).map((tz) => (
                    <button
                      key={tz.value}
                      onClick={() => setLocalSettings((p) => ({ ...p, timezone: tz.value }))}
                      className={`w-full flex items-center justify-between p-2.5 rounded-lg text-xs transition text-left border ${
                        localSettings.timezone === tz.value
                          ? 'bg-amber-400/15 border-amber-400 text-amber-300 font-bold'
                          : 'bg-ink-900/40 border-ink-800 text-slate-300 hover:bg-ink-800'
                      }`}
                    >
                      <span>{tz.label}</span>
                      {localSettings.timezone === tz.value && <span>✓ Selected</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* CATEGORY G: APPEARANCE */}
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-bold text-white text-base">Chart Appearance</h3>
                  <p className="text-xs text-slate-400">Customize candlestick colors, canvas themes, and grid lines.</p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="p-3 rounded-lg bg-ink-900/50 border border-ink-800 flex items-center justify-between">
                    <span>Bullish Candle Color:</span>
                    <input
                      type="color"
                      value={localSettings.bullishCandleColor}
                      onChange={(e) => setLocalSettings((p) => ({ ...p, bullishCandleColor: e.target.value }))}
                      className="w-8 h-8 rounded border-none bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="p-3 rounded-lg bg-ink-900/50 border border-ink-800 flex items-center justify-between">
                    <span>Bearish Candle Color:</span>
                    <input
                      type="color"
                      value={localSettings.bearishCandleColor}
                      onChange={(e) => setLocalSettings((p) => ({ ...p, bearishCandleColor: e.target.value }))}
                      className="w-8 h-8 rounded border-none bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="p-3 rounded-lg bg-ink-900/50 border border-ink-800 flex items-center justify-between">
                    <span>Chart Background:</span>
                    <input
                      type="color"
                      value={localSettings.backgroundColor}
                      onChange={(e) => setLocalSettings((p) => ({ ...p, backgroundColor: e.target.value }))}
                      className="w-8 h-8 rounded border-none bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="p-3 rounded-lg bg-ink-900/50 border border-ink-800 flex items-center justify-between">
                    <span>Crosshair Guide Color:</span>
                    <input
                      type="color"
                      value={localSettings.crosshairColor}
                      onChange={(e) => setLocalSettings((p) => ({ ...p, crosshairColor: e.target.value }))}
                      className="w-8 h-8 rounded border-none bg-transparent cursor-pointer"
                    />
                  </div>
                </div>

                {/* Long-press Tooltip Settings (Part 5) */}
                <div className="p-4 rounded-lg bg-ink-900/50 border border-ink-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-white">Values Tooltip on Long Press (Part 5)</div>
                      <div className="text-[11px] text-slate-400">Holding down on a candle shows the complete floating values card.</div>
                    </div>
                    <button
                      onClick={() => handleToggle('longPressTooltipEnabled')}
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        localSettings.longPressTooltipEnabled ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${localSettings.longPressTooltipEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {localSettings.longPressTooltipEnabled && (
                    <div className="flex items-center gap-3 pt-2 text-xs">
                      <span className="text-slate-400">Long press duration:</span>
                      <input
                        type="range"
                        min="200"
                        max="1000"
                        step="50"
                        value={localSettings.longPressDurationMs}
                        onChange={(e) => setLocalSettings((p) => ({ ...p, longPressDurationMs: parseInt(e.target.value) || 400 }))}
                        className="flex-1 accent-amber-400"
                      />
                      <span className="font-mono text-amber-300">{localSettings.longPressDurationMs} ms</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CATEGORY H: SCALES */}
            {activeTab === 'scales' && (
              <div className="space-y-4 text-xs">
                <div>
                  <h3 className="font-bold text-white text-base">Price & Scale Settings</h3>
                  <p className="text-xs text-slate-400">Control axis scaling algorithms, logarithmic views, and price line guides.</p>
                </div>

                {[
                  { key: 'autoScale', label: 'Auto Scale', desc: 'Automatically adapt the visible vertical price scale to fit candles.' },
                  { key: 'logarithmicScale', label: 'Logarithmic Scale', desc: 'Proportional percentage scaling across high-volatility ranges.' },
                  { key: 'percentageScale', label: 'Percentage Scale', desc: 'Displays price axis as percentage delta from the first visible bar.' },
                  { key: 'showBidAskLines', label: 'Bid / Ask Lines', desc: 'Render real-time horizontal guide lines for current Bid and Ask spread.' },
                  { key: 'showCurrentPriceLine', label: 'Current Price Line', desc: 'Render prominent dashed line with price badge on the scale.' },
                ].map((sc) => (
                  <div key={sc.key} className="flex items-center justify-between p-2.5 rounded-lg bg-ink-900/50 border border-ink-800">
                    <div>
                      <div className="font-semibold text-white">{sc.label}</div>
                      <div className="text-[11px] text-slate-400">{sc.desc}</div>
                    </div>
                    <button
                      onClick={() => handleToggle(sc.key as any)}
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        (localSettings as any)[sc.key] ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${(localSettings as any)[sc.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* CATEGORY I: TRADING VISUALIZATION */}
            {activeTab === 'visualization' && (
              <div className="space-y-4 text-xs">
                <div>
                  <h3 className="font-bold text-white text-base">Trading Visualization</h3>
                  <p className="text-xs text-slate-400">Position entry levels, pending order triggers, and collision avoidance.</p>
                </div>

                {[
                  { key: 'showEntryLines', label: 'Position Entry Lines', desc: 'Draw horizontal line at entry price with quantity tag.' },
                  { key: 'showAvgEntryPrice', label: 'Average Entry Price', desc: 'Show aggregated breakeven line when holding multiple positions.' },
                  { key: 'showPendingLines', label: 'Pending Order Lines', desc: 'Draw dashed lines at trigger price for Limit & Stop orders.' },
                  { key: 'showExecutionMarkers', label: 'Execution Markers', desc: 'Show small arrows on candles where orders were executed.' },
                  { key: 'showPnlLabels', label: 'Floating P&L Labels', desc: 'Display live USD profit/loss badge next to each open position.' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-2.5 rounded-lg bg-ink-900/50 border border-ink-800">
                    <div>
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-[11px] text-slate-400">{item.desc}</div>
                    </div>
                    <button
                      onClick={() => handleToggle(item.key as any)}
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        (localSettings as any)[item.key] ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${(localSettings as any)[item.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* CATEGORY J: GENERAL BEHAVIOR */}
            {activeTab === 'general' && (
              <div className="space-y-4 text-xs">
                <div>
                  <h3 className="font-bold text-white text-base">General Chart Behavior</h3>
                  <p className="text-xs text-slate-400">Persistence across browser reloads, auto-scroll, and memory.</p>
                </div>

                {[
                  { key: 'autoScrollToLatest', label: 'Auto Scroll to Latest Candle', desc: 'Automatically pan to the latest candle when new live ticks arrive.' },
                  { key: 'scrollToLoadHistory', label: 'Scroll to Load History', desc: 'Fetch previous historical candles when panning past the leftmost bar.' },
                  { key: 'keepDrawingsVisible', label: 'Keep Drawings Visible', desc: 'Ensure all trendlines, zones, and fibo retracements remain rendered.' },
                  { key: 'rememberSettings', label: 'Remember Settings across Sessions', desc: 'Persist all configurations in browser localStorage.' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-2.5 rounded-lg bg-ink-900/50 border border-ink-800">
                    <div>
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-[11px] text-slate-400">{item.desc}</div>
                    </div>
                    <button
                      onClick={() => handleToggle(item.key as any)}
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        (localSettings as any)[item.key] ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${(localSettings as any)[item.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="h-14 px-6 border-t border-ink-800 bg-ink-900/60 flex items-center justify-between shrink-0">
          <button
            onClick={() => setLocalSettings(DEFAULT_CHART_SETTINGS)}
            className="text-xs text-slate-400 hover:text-white transition underline"
          >
            Reset All to Defaults
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-ink-800 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAndClose}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-ink-950 shadow transition"
            >
              Save & Apply
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
