import React, { useState } from 'react';
import { SYMBOL_LIST, PAYLINES } from './pharaoh-config';
import { SymbolTile } from './pharaoh-images';
import { SpinHistoryItem } from './pharaoh-types';

interface PanelProps {
  onClose: () => void;
}

export interface SettingsModalProps {
  onClose: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  autoPlay: boolean;
  autoPlayCount: number;
  onStartAutoPlay: (count: number) => void;
  onStopAutoPlay: () => void;
  history: SpinHistoryItem[];
  defaultTab?: 'sound' | 'auto' | 'history' | 'rules';
}

/**
 * Unified Pharaoh Settings Modal
 * Covers: Sound, Custom Auto-Spin, Spin History & Game Rules / Paytable
 */
export const PharaohSettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  soundEnabled,
  onToggleSound,
  autoPlay,
  autoPlayCount,
  onStartAutoPlay,
  onStopAutoPlay,
  history,
  defaultTab = 'sound',
}) => {
  const [activeTab, setActiveTab] = useState<'sound' | 'auto' | 'history' | 'rules'>(defaultTab);
  const [customSpinCount, setCustomSpinCount] = useState<number>(20);
  const [stopOnBonus, setStopOnBonus] = useState<boolean>(true);

  const autoSpinPresets = [10, 20, 50, 100, 250];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4 md:p-6 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-2xl overflow-hidden flex flex-col rounded-2xl border-2 border-[#F5C451]/70 bg-gradient-to-b from-[#0e172e] via-[#090f20] to-[#050814] shadow-[0_0_50px_rgba(245,196,81,0.35)] text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[#F5C451]/30 bg-black/40">
          <div className="flex items-center space-x-2">
            <span className="text-[#F5C451] text-lg sm:text-xl">⚙️</span>
            <h2 className="text-base sm:text-lg md:text-xl font-black tracking-widest text-[#F5C451] drop-shadow-md">
              গেম সেটিংস (SETTINGS)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-[#F5C451] hover:text-black text-gray-300 font-black flex items-center justify-center transition active:scale-95 border border-white/20"
          >
            ✕
          </button>
        </div>

        {/* 4 Navigation Tabs */}
        <div className="grid grid-cols-4 border-b border-white/10 bg-black/60 p-1 gap-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider">
          <button
            onClick={() => setActiveTab('sound')}
            className={`py-2 rounded-lg transition-all flex items-center justify-center space-x-1 ${
              activeTab === 'sound'
                ? 'bg-gradient-to-r from-[#F5C451] to-[#D49A24] text-black font-black shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>🔊</span>
            <span className="hidden sm:inline">সাউন্ড</span>
          </button>
          <button
            onClick={() => setActiveTab('auto')}
            className={`py-2 rounded-lg transition-all flex items-center justify-center space-x-1 ${
              activeTab === 'auto'
                ? 'bg-gradient-to-r from-[#F5C451] to-[#D49A24] text-black font-black shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>🔄</span>
            <span className="hidden sm:inline">অটো স্পিন</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-2 rounded-lg transition-all flex items-center justify-center space-x-1 ${
              activeTab === 'history'
                ? 'bg-gradient-to-r from-[#F5C451] to-[#D49A24] text-black font-black shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>📜</span>
            <span className="hidden sm:inline">হিস্ট্রি</span>
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`py-2 rounded-lg transition-all flex items-center justify-center space-x-1 ${
              activeTab === 'rules'
                ? 'bg-gradient-to-r from-[#F5C451] to-[#D49A24] text-black font-black shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>📖</span>
            <span className="hidden sm:inline">নিয়মাবলী</span>
          </button>
        </div>

        {/* Tab Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* TAB 1: SOUND */}
          {activeTab === 'sound' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between p-4 rounded-xl bg-black/40 border border-[#F5C451]/30">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <span>{soundEnabled ? '🔊' : '🔇'}</span>
                    <span>মাস্টার সাউন্ড ইফেক্টস (Game Audio)</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    রিল স্পিন, ল্যান্ডিং টিক এবং ক্রিস্টাল বেল সাউন্ড চালু বা বন্ধ করুন
                  </p>
                </div>
                <button
                  onClick={onToggleSound}
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all shadow-md ${
                    soundEnabled
                      ? 'bg-gradient-to-r from-[#10b981] to-[#059669] text-white shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                      : 'bg-red-950/60 text-red-300 border border-red-500/30'
                  }`}
                >
                  {soundEnabled ? 'চালু (ON)' : 'বন্ধ (OFF)'}
                </button>
              </div>

              <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-2">
                <h4 className="text-xs font-bold text-[#F5C451] uppercase tracking-wider">
                  🎵 সাউন্ড ফিচারসমূহ:
                </h4>
                <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside">
                  <li>সফট ভেলভেট মেকানিক্যাল রিল রোলিং টিক</li>
                  <li>ডিপ বাস রিল লক অ্যান্ড গোল্ড স্টপ সাউন্ড</li>
                  <li>ক্রিস্টালাইন গোল্ডেন উইন বেল হারমোনি</li>
                  <li>১০ ফ্রি স্পিন রয়্যাল ফ্যানফেয়ার</li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB 2: AUTO SPIN */}
          {activeTab === 'auto' && (
            <div className="space-y-4 animate-fade-in">
              {autoPlay ? (
                <div className="p-5 rounded-xl bg-amber-500/10 border-2 border-amber-500/40 text-center space-y-3">
                  <div className="text-2xl animate-spin inline-block">🔄</div>
                  <h3 className="text-base font-bold text-[#F5C451]">
                    অটো স্পিন বর্তমানে চালু আছে
                  </h3>
                  <p className="text-xs text-gray-300">
                    বাকি স্পিনের সংখ্যা: <strong className="text-xl font-mono text-white">{autoPlayCount}</strong>
                  </p>
                  <button
                    onClick={() => {
                      onStopAutoPlay();
                      onClose();
                    }}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 text-white font-black text-xs uppercase tracking-wider shadow-lg hover:brightness-110 active:scale-95 transition"
                  >
                    অটো স্পিন বন্ধ করুন (STOP AUTO)
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block mb-2">
                      ১. স্পিনের সংখ্যা নির্বাচন করুন (Select Preset):
                    </label>
                    <div className="grid grid-cols-5 gap-2">
                      {autoSpinPresets.map((cnt) => (
                        <button
                          key={cnt}
                          onClick={() => setCustomSpinCount(cnt)}
                          className={`py-2 rounded-xl text-xs font-black transition-all ${
                            customSpinCount === cnt
                              ? 'bg-gradient-to-b from-[#F5C451] via-[#D49A24] to-[#A66B16] text-[#080E24] shadow-[0_0_12px_#F5C451] scale-105 border border-white'
                              : 'bg-black/40 text-gray-300 border border-white/10 hover:border-[#F5C451]/50'
                          }`}
                        >
                          {cnt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block mb-1">
                      ২. অথবা ইচ্ছামতো স্পিন লিখুন (Custom Count):
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={customSpinCount}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v > 0) setCustomSpinCount(Math.min(1000, v));
                        }}
                        className="flex-1 bg-black/60 border border-[#F5C451]/40 rounded-xl px-3 py-2 text-white font-mono font-bold text-sm focus:outline-none focus:border-[#F5C451]"
                        placeholder="স্পিন সংখ্যা লিখুন..."
                      />
                      <span className="text-xs text-gray-400 font-bold">স্পিন</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-black/30 border border-white/10">
                    <label className="flex items-center space-x-2.5 cursor-pointer text-xs text-gray-300 font-medium select-none">
                      <input
                        type="checkbox"
                        checked={stopOnBonus}
                        onChange={(e) => setStopOnBonus(e.target.checked)}
                        className="w-4 h-4 rounded text-[#F5C451] accent-[#F5C451] cursor-pointer"
                      />
                      <span>বোনাস বা ফ্রি স্পিন হিট হলে অটো-স্পিন থামান (Stop on Bonus)</span>
                    </label>
                  </div>

                  <button
                    onClick={() => {
                      onStartAutoPlay(customSpinCount);
                      onClose();
                    }}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-[#F5C451] via-[#FFF2A3] to-[#D49A24] text-[#080E24] font-black text-sm uppercase tracking-widest shadow-[0_0_20px_rgba(245,196,81,0.5)] hover:scale-[1.02] active:scale-95 transition"
                  >
                    অটো স্পিন শুরু করুন ({customSpinCount} স্পিন)
                  </button>
                </>
              )}
            </div>
          )}

          {/* TAB 3: SPIN HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-3 animate-fade-in">
              <div className="flex items-center justify-between text-xs text-gray-400 pb-1 border-b border-white/10">
                <span>সাম্প্রতিক স্পিন হিস্ট্রি (সর্বশেষ ২০টি)</span>
                <span>মোট রেকর্ড: {history.length}</span>
              </div>

              {history.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-xs">
                  <div className="text-3xl mb-2 opacity-50">📜</div>
                  <p>এখনো কোনো স্পিন হিস্ট্রি পাওয়া যায়নি।</p>
                  <p className="text-[10px] text-gray-500 mt-1">স্পিন করার পর ফলাফল এখানে স্বয়ংক্রিয়ভাবে সেভ হবে।</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                  {history.map((item, idx) => {
                    const isWin = item.win > 0;
                    return (
                      <div
                        key={item.id || idx}
                        className={`flex items-center justify-between p-2.5 rounded-xl border transition ${
                          item.isBonus
                            ? 'bg-amber-950/30 border-[#F5C451]/60 shadow-[0_0_10px_rgba(245,196,81,0.2)]'
                            : isWin
                            ? 'bg-emerald-950/20 border-emerald-500/30'
                            : 'bg-black/30 border-white/5'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-mono text-gray-400">#{history.length - idx}</span>
                          <div>
                            <span className="text-xs font-bold text-white block">
                              বেট: ৳{item.bet} &bull; {item.multiplier}X
                            </span>
                            <span className="text-[9px] text-gray-400">{item.time}</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span
                            className={`font-mono text-xs sm:text-sm font-black block ${
                              isWin ? 'text-[#19C6C2]' : 'text-gray-400'
                            }`}
                          >
                            {isWin ? `+৳${item.win.toLocaleString()}` : '৳০'}
                          </span>
                          {item.isBonus ? (
                            <span className="text-[8px] uppercase tracking-wider font-bold text-[#F5C451]">
                              👑 বোনাস হিট!
                            </span>
                          ) : isWin ? (
                            <span className="text-[8px] uppercase tracking-wider font-bold text-emerald-400">
                              🎉 জয়ী
                            </span>
                          ) : (
                            <span className="text-[8px] text-gray-500">নো উইন</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: RULES & PAYTABLE */}
          {activeTab === 'rules' && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <h3 className="text-xs font-bold text-[#F5C451] uppercase tracking-wider mb-2">
                  🏆 প্রতীক ও পে-আউট মাল্টিপ্লায়ার (Symbol Paytable):
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SYMBOL_LIST.map((sym) => (
                    <div
                      key={sym.id}
                      className="flex items-center space-x-2.5 p-2 rounded-xl bg-black/40 border border-[#F5C451]/20"
                    >
                      <div className="w-12 h-14 flex-shrink-0">
                        <SymbolTile symId={sym.id} size="sm" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-[#FFF2A3] truncate">{sym.name}</h4>
                          <span className="text-[8px] font-bold text-[#19C6C2] uppercase">
                            {sym.tierLabel ?? sym.type}
                          </span>
                        </div>
                        <div className="flex space-x-2 text-[10px] font-mono mt-0.5">
                          <span className="text-gray-300">5x: <strong className="text-[#F5C451]">{sym.multiplier[2]}x</strong></span>
                          <span className="text-gray-300">4x: <strong className="text-[#19C6C2]">{sym.multiplier[1]}x</strong></span>
                          <span className="text-gray-300">3x: <strong className="text-gray-200">{sym.multiplier[0]}x</strong></span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-black/30 border border-[#F5C451]/20 space-y-1.5 text-xs text-gray-300">
                <h4 className="font-bold text-[#F5C451] uppercase text-[11px]">
                  📜 খেলার নিয়মের বিবরণ (Game Rules):
                </h4>
                <p>&bull; <strong>৫ রিল ও ৩ রো</strong>: মোট ২০টি নির্দিষ্ট পে-লাইনে বাঁ দিক থেকে ডান দিকে মিললে পুরষ্কার পাওয়া যাবে।</p>
                <p>&bull; <strong>ওয়াইল্ড প্রতীক (Ancient Wild)</strong>: স্ক্যাটার বাদে সব চিহ্নের বিকল্প হিসেবে কাজ করে এবং সর্বোচ্চ পে-আউট দেয়।</p>
                <p>&bull; <strong>স্ক্যাটার ও ১০ ফ্রি স্পিন</strong>: যেকোনো স্থানে ৩টি বা তার বেশি স্ক্যাটার পড়লে সাথে সাথে ১০টি ফ্রি স্পিন সক্রিয় হবে।</p>
                <p>&bull; <strong>মাল্টিপ্লায়ার বার (1X - 5X)</strong>: উপরের ১X থেকে ৫X বাটন ব্যবহার করে জয় করা অর্থ সরাসরি গুণ করে নেওয়া যায়।</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const PaytablePanel: React.FC<PanelProps> = ({ onClose }) => {
  return (
    <PharaohSettingsModal
      onClose={onClose}
      soundEnabled={true}
      onToggleSound={() => {}}
      autoPlay={false}
      autoPlayCount={0}
      onStartAutoPlay={() => {}}
      onStopAutoPlay={() => {}}
      history={[]}
      defaultTab="rules"
    />
  );
};

export const GameRulesPanel: React.FC<PanelProps> = ({ onClose }) => {
  return (
    <PharaohSettingsModal
      onClose={onClose}
      soundEnabled={true}
      onToggleSound={() => {}}
      autoPlay={false}
      autoPlayCount={0}
      onStartAutoPlay={() => {}}
      onStopAutoPlay={() => {}}
      history={[]}
      defaultTab="rules"
    />
  );
};
