import React, { useState, useEffect } from "react";
import Sidebar from "./sidebar";
import DashboardHeader from "./dashboard-header";

interface MainLayoutProps {
  profile: DashboardHeaderProfile;
  onToggleSidebar: () => void;
  onCopyUid: () => void;
  onToggleMask: () => void;
  children: React.ReactNode;
  selectedMenu: string;
  onMenuSelect: (menu: string) => void;
}

interface DashboardHeaderProfile {
  username: string;
  uid: string;
  avatar: string;
  vipLevel: string;
  following: number;
  followers: number;
  wallet: {
    amount: string;
    currency: string;
    usdValue: string;
  };
}

export default function MainLayout({
  profile,
  children,
  onToggleSidebar,
  onCopyUid,
  onToggleMask,
  selectedMenu,
  onMenuSelect,
export default function MainLayout({
  profile,
useEffect(() => {
    // When menu is selected, close sidebar on mobile and navigate
    const handleSelect = (menu: string) => {
      setIsOpen(false);
      onMenuSelect(menu);
      // Navigate to the selected page
      router.push(`/${menu}`);
    };

    // Close sidebar on mobile when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      const sidebar = document.querySelector(".fixed.left-0");
      if (sidebar && !sidebar.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onMenuSelect, router]);
  children,
  selectedMenu,
  onMenuSelect,
}: MainLayoutProps) {
<div className="md:ml-0 transition-all duration-300">
  const router = useRouter();
}: MainLayoutProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Close sidebar on mobile when a menu item is selected
    const handleClickOutside = (event: MouseEvent) => {
      const sidebar = document.querySelector(".fixed.left-0");
      if (sidebar && !sidebar.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Sidebar */}
      <Sidebar
        isOpen={isOpen}
        onToggle={() => setIsOpen((prev) => !prev)}
        selectedMenu={selectedMenu}
        onSelect={onMenuSelect}
      />

      {/* Main Content */}
      <div className="md:ml-64 transition-all duration-300">
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={() => setIsOpen(false)}
          />
        )}

        <header className="border-b border-gray-700 bg-gray-950/90 backdrop-blur-lg sticky top-0 z-50">
          <DashboardHeader
            profile={profile}
            onToggleSidebar={() => setIsOpen((prev) => !prev)}
            onCopyUid={onCopyUid}
            onToggleMask={onToggleMask}
          />
        </header>

        <main className="p-6 md:p-12 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}