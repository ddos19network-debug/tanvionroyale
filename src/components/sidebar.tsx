import React from "react";

const menuItems = [
  { key: "dashboard", label: "Dashboard" },
  { key: "assets", label: "Assets" },
  { key: "betting", label: "Betting & Live Sports" },
  { key: "games", label: "Games & Casino" },
  { key: "deposits", label: "Deposits & Withdrawals" },
  { key: "wallet", label: "Wallet" },
  { key: "subaccounts", label: "Sub Accounts" },
  { key: "royalepay", label: "Royale Pay" },
  { key: "orders", label: "Orders" },
  { key: "rewards", label: "Rewards Hub" },
  { key: "referral", label: "Referral" },
  { key: "account", label: "Account & Security" },
  { key: "activity", label: "Activity" },
  { key: "settings", label: "Settings" },
];

const icons: Record<string, string> = {
  dashboard: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m-3-3v1a1 1 0 01-1 1h-3m-5-3h5m3-5V5a1 1 0 011-1h2a1 1 0 011 1v2Z",
  assets: "M12 7v6l4 2-4 2v-6l-4 2-4-2v-6l4-2 4-2Z",
  betting: "M12 4v16m8-8H4",
  games: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  deposits: "M12 22S8 14 4 12 1 8 5 5s4-3 4-3V5l3 3v4a2 2 0 002 2h4a2 2 0 002-2V5l3 3v4a2 2 0 002 2h4a2 2 0 002-2V5l3 3v4a2 2 0 002 2h4a2 2 0 002-2l-3-3v-4a2 2 0 00-2-2h-4a2 2 0 00-2 2v4l-3 3v4Z",
  wallet: "M12 22S8 14 4 12 1 8 5 5s4-3 4-3V5l3 3v4a2 2 0 002 2h4a2 2 0 002-2V5l3 3v4a2 2 0 002 2h4a2 2 0 002-2V5l3 3v4a2 2 0 002 2h4a2 2 0 002-2l-3-3v-4a2 2 0 00-2-2h-4a2 2 0 00-2 2v4l-3 3v4Z",
  subaccounts: "M12 3v8l6 3a3 3 0 003-3H9a3 3 0 00-3 3V3Zm0 3.84l-1.18 2.08.65 3.61 2.3-1.07.88-.71a1 1 0 01.06-.83l.1-2.85Zm6.38.16l-2.3 1.07-.65-3.61-1.18-2.08-.88.71a1 1 0 01-.06.83l.1 2.85ZM5.82 9.56l-.76 1.95 1.95.76 2.08-.75-3.52-2.16.53-.38Zm7.53 0l.76 1.95-1.95.76-2.08-.75 3.52-2.16-.53-.38Zm-5.82-5.82l.76-1.95 2.08.75-1.95-.76-2.16 3.52.38.53Zm7.53 0l.76-1.95-2.08-.75 3.52 2.16.53.38Zm-5.82 5.82l-.76 1.95-1.95.76-2.08.75 3.52 2.16-.53.38Zm7.53 0l-.76-1.95-2.08-.75 3.52 2.16.53.38ZM5.82 14.44l-.76-1.95 1.95-.76-2.08.75 3.52 2.16-.53.38Zm7.53 0.16l2.3-1.07.65 3.61-1.18 2.08.88.71a1 1 0 01.06.83l.1 2.85Zm-6.38-.16l2.3-1.07-.65-3.61 1.18 2.08.88.71a1 1 0 01.06.83l.1 2.85Z",
  royalepay: "M2 12l20-8v16L2 20V12Zm8.36-1l1.9 2.62.89-4.12H13Zm6.22 0l.89 4.12-.65 3.37.87-4.12H19Zm0 0l-.65-3.37.87 4.12H19Zm0 0l-.65-3.37.87 4.12H19Zm0 0l-.65-3.37.87 4.12H19Zm0 0l-.17.45a1 1 0 01-.96.76H4.37a1 1 0 01-.96-.76L2 12Zm19.78 0a5.01 5.01 0 01-.28 6.37 5.01 5.01 0 01-.72 4.06 5.01 5.01 0 01-1.89 1.26A4.5 4.5 0 0112 16s-4.5-3.75-4.5-8.25a4.5 4.5 0 014.5-4.25 4.5 4.5 0 014.5 4.25Zm-2.1 5.63a3.37 3.37 0 01-.86 2.13 3.37 3.37 0 01-.86-2.13 3.37 3.37 0 01-.86-2.13 3.37 3.37 0 01-.86 2.13Z",
  orders: "M3 4h18M3 8h18M3 12h18M3 16h18",
  rewards: "M12 20v-6m4-4h-4m-4 4h4m6.6-7.7c.9 0 1.8.2 2.7.7m0 0l-.7-2.5C13.8 4.6 12.3 5 10.3 5h-5.5a4.98 4.98 0 00-3.4 3.3m0 0L5 15m4.6-5.3L11 8M13.5 3.3c-.9 0-1.8.2-2.7.7m0 0L5 15m4.6-5.3L11 8",
  referral: "M2 12l20-8v16L2 20V12Zm8.36-1l1.9 2.62.89-4.12H13Zm6.22 0l.89 4.12-.65 3.37.87-4.12H19Zm0 0l-.65-3.37.87 4.12H19Zm0 0l-.65-3.37.87 4.12H19Zm0 0l-.17.45a1 1 0 01-.96.76H4.37a1 1 0 01-.96-.76L2 12Zm19.78 0a5.01 5.01 0 01-.28 6.37 5.01 5.01 0 01-.72 4.06 5.01 5.01 0 01-1.89 1.26A4.5 4.5 0 0112 16s-4.5-3.75-4.5-8.25a4.5 4.5 0 014.5-4.25 4.5 4.5 0 014.5 4.25Zm-2.1 5.63a3.37 3.37 0 01-.86 2.13 3.37 3.37 0 01-.86-2.13 3.37 3.37 0 01-.86-2.13 3.37 3.37 0 01-.86 2.13Z",
  account: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7v1h14v-1a7 7 0 00-7-7z",
  activity: "M12 20V10M18 10v8a2 2 0 01-2 2H12a2 2 0 01-2-2v-8M12 4a8 8 0 11-8 8 8 8 0 018-8zm0 4a4 4 0 100 8 4 4 0 00-8 0z",
  settings: "M12 3vM7a5 5 0 015 5h4a2 2 0 012 2v4m0-8A7 7 0 005 7c0 4 7 11 7 11a9 9 0 00-9-9 9 9 0 00-9 9c0 5 6 9 6 9s6-4 6-9a7 7 0 00-7-7c0-4 7-11 7-11z",
};

export default function Sidebar({
  isOpen,
  onToggle,
  selectedMenu,
  onSelect,
}: {
  isOpen: boolean;
  onToggle: () => void;
  selectedMenu: string;
  onSelect: (menu: string) => void;
}) {
  return (
    <div
      className={`fixed left-0 top-0 h-full w-64 bg-[#1B212D] border-r border-gray-700 transition-transform duration-300 ease-in-out sm:translate-x-0 ${isOpen ? "" : "-translate-x-full"} md:translate-x-0`}
    >
      <div className="h-full p-4 flex flex-col">
        <div className="h-14 flex items-center justify-between mb-6">
          <button
            onClick={onToggle}
            className="p-2 rounded hover:bg-gray-800 transition-colors"
            aria-label="Open menu"
          >
            {isOpen ? (
              <svg
                className="w-5 h-5 text-white"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M7 6L5 8h2v10H5v2h10v-2h5v-10h-2v6zM7 6" />
              </svg>
            ) : (
              <svg
                className="w-5 h-5 text-white"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m-3-3v1a1 1 0 01-1 1h-3m-5-3h5m3-5V5a1 1 0 011-1h2a1 1 0 011 1v2Z" />
              </svg>
<h2 className="text-xl font-bold text-white tracking-wider">ROYALE EXCHANGE</h2>
          {isOpen && (
            <button
              onClick={onToggle}
              className="hidden md:block p-2 rounded hover:bg-gray-800 transition-colors"
              aria-label="Close menu"
            >
              <svg
                className="w-5 h-5 text-white"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              Back to Menu
            </button>

          )}


            )}
          </button>
          <h2 className="text-xl font-bold text-white tracking-wider">ROYALE EXCHANGE</h2>
        </div>

        <nav className="flex-1 flex flex-col space-y-1">
          {menuItems.map((item) => (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={`flex items-center gap-3 px-3 py-2 rounded text-left text-sm font-medium ${selectedMenu === item.key ? "bg-gray-900/30 text-white" : "text-gray-300 hover:text-white hover:bg-gray-900/20 transition-all"}`}
              data-menu={item.key}
            >
              <svg
                className="w-4 h-4 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d={icons[item.key] || ""} />
              </svg>
